const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'organization-tests-only-secret';
const app = require('../src/app');
const Department = require('../src/modules/organization/models/department');
const Employee = require('../src/modules/auth/models/employee');
const Organization = require('../src/modules/organization/models/organization');
const service = require('../src/modules/organization/services/departmentservice');
const organizationService = require('../src/modules/organization/services/organizationservice');
const { fields, pagination } = require('../src/modules/organization/services/validation');

test('rejects invalid input and normalizes department codes', () => {
  assert.deepEqual(fields({ name: ' Engineering ', code: ' eng ' }, ['name', 'code'], ['name', 'code']), { name: 'Engineering', code: 'ENG' });
  for (const body of [null, [], {}, { name: '' }, { status: 'deleted' }, { status: '' }, { headEmployeeId: 'bad' }, { singletonKey: 'other' }]) {
    assert.throws(() => fields(body, ['name', 'status', 'headEmployeeId']), { statusCode: 400 });
  }
  assert.throws(() => fields({ timezone: 'Imaginary/City' }, ['timezone']), { statusCode: 400 });
  assert.throws(() => fields({ logoUrl: 'javascript:alert(1)' }, ['logoUrl']), { statusCode: 400 });
  assert.deepEqual(pagination({}), { page: 1, limit: 20 });
  for (const query of [{ page: '0' }, { limit: '101' }, { page: { $gt: 0 } }]) {
    assert.throws(() => pagination(query), { statusCode: 400 });
  }
});

test('requires an existing employee when selecting a department head', async (t) => {
  t.mock.method(Employee, 'exists', async () => null);
  await assert.rejects(service.createDepartment({ name: 'Engineering', code: 'ENG', headEmployeeId: '507f1f77bcf86cd799439011' }), { statusCode: 404 });
});

test('rejects missing or inactive departments for new assignments', async (t) => {
  const lookup = t.mock.method(Department, 'findById', async () => null);
  await assert.rejects(service.resolveDepartment('bad'), { statusCode: 400 });
  await assert.rejects(service.resolveDepartment('507f1f77bcf86cd799439011'), { statusCode: 404 });
  lookup.mock.mockImplementation(async () => ({ status: 'inactive' }));
  await assert.rejects(service.resolveDepartment('507f1f77bcf86cd799439011'), { statusCode: 400 });
});

test('department assignment updates ID and legacy name; null removes both', async (t) => {
  const employee = { save: async () => {}, populate: async () => employee };
  t.mock.method(Employee, 'findById', async () => employee);
  t.mock.method(Department, 'findById', async () => ({ _id: '507f1f77bcf86cd799439011', name: 'Engineering', status: 'active' }));
  await service.assignDepartment('507f1f77bcf86cd799439012', { departmentId: '507f1f77bcf86cd799439011' });
  assert.equal(employee.departmentId, '507f1f77bcf86cd799439011');
  assert.equal(employee.department, 'Engineering');
  await service.assignDepartment('507f1f77bcf86cd799439012', { departmentId: null });
  assert.equal(employee.departmentId, null);
  assert.equal(employee.department, '');
  await assert.rejects(service.assignDepartment('507f1f77bcf86cd799439012', { departmentId: null, role: 'admin' }), { statusCode: 400 });
});

test('deactivating a department keeps existing employee assignments', async (t) => {
  const department = { status: 'active', save: async () => {}, populate: async () => department };
  t.mock.method(Department, 'findById', async () => department);
  t.mock.method(Employee, 'updateMany', async () => { throw new Error('Assignments must be preserved'); });
  await service.updateDepartment('507f1f77bcf86cd799439011', { status: 'inactive' });
  assert.equal(department.status, 'inactive');
});

test('lists paginated departments with literal search and assignment counts', async (t) => {
  let filter;
  const query = {
    sort() { return this; }, skip(value) { assert.equal(value, 10); return this; },
    limit(value) { assert.equal(value, 10); return this; }, populate() { return this; },
    async lean() { return [{ _id: 'department-1', name: 'Engineering' }, { _id: 'department-2', name: 'HR' }]; },
  };
  t.mock.method(Department, 'find', (value) => { filter = value; return query; });
  t.mock.method(Department, 'countDocuments', async () => 12);
  t.mock.method(Employee, 'aggregate', async () => [{ _id: 'department-1', count: 3 }]);
  const result = await service.listDepartments({ search: 'a.*', status: 'active', page: '2', limit: '10' });
  assert.equal(filter.$or[0].name.$regex, 'a\\.\\*');
  assert.equal(filter.status, 'active');
  assert.deepEqual(result.departments.map((department) => department.employeeCount), [3, 0]);
  assert.deepEqual(result.pagination, { page: 2, limit: 10, total: 12, totalPages: 2 });
});

test('requires company name and code on initial organization setup', async (t) => {
  t.mock.method(Organization, 'findOne', async () => null);
  await assert.rejects(organizationService.updateOrganization({ description: 'Company' }), { statusCode: 400 });
  const create = t.mock.method(Organization, 'create', async (value) => value);
  const organization = await organizationService.updateOrganization({ name: 'Company', code: 'co' });
  assert.equal(organization.singletonKey, 'company');
  assert.equal(organization.code, 'CO');
  assert.equal(create.mock.callCount(), 1);
});

test('organization summary uses stored counts and marks unavailable modules', async (t) => {
  t.mock.method(Employee, 'countDocuments', async () => 25);
  t.mock.method(Department, 'countDocuments', async (filter) => filter.status ? 2 : 3);
  assert.deepEqual(await organizationService.getSummary(), {
    totalEmployees: 25, departments: 3, activeDepartments: 2, teams: null, activeReviewFrameworks: null,
  });
});

let server;
after(async () => { if (server) await new Promise((resolve) => server.close(resolve)); });

test('organization APIs enforce HR/admin access and return validation and conflict errors', async (t) => {
  server = await new Promise((resolve) => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (path, role, method = 'GET', body) => fetch(base + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(role && { Authorization: `Bearer ${jwt.sign({ id: '507f1f77bcf86cd799439011', role }, process.env.JWT_SECRET)}` }),
    },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  for (const [path, method] of [['/api/organization', 'GET'], ['/api/organization', 'PATCH'], ['/api/organization/summary', 'GET'], ['/api/departments', 'GET'], ['/api/departments', 'POST'], ['/api/departments/507f1f77bcf86cd799439011', 'PATCH'], ['/api/employees/507f1f77bcf86cd799439011/department', 'PATCH']]) {
    assert.equal((await request(path, null, method)).status, 401);
    assert.equal((await request(path, 'employee', method)).status, 403);
  }
  t.mock.method(Organization, 'findOne', () => ({ lean: async () => null }));
  for (const role of ['hr', 'admin']) {
    const response = await request('/api/organization', role);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { organization: null });
  }
  assert.equal((await request('/api/departments', 'hr', 'POST', { name: '' })).status, 400);
  assert.equal((await request('/api/departments/bad', 'hr', 'PATCH', { name: 'Finance' })).status, 400);
  t.mock.method(Department, 'create', async () => { throw Object.assign(new Error('Duplicate'), { code: 11000 }); });
  assert.equal((await request('/api/departments', 'admin', 'POST', { name: 'Engineering', code: 'ENG' })).status, 409);
});

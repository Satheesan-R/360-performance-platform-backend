const { test } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
process.env.JWT_SECRET = 'employment-types-test-secret';
const app = require('../src/app');
const Organization = require('../src/modules/organization/models/organization');
const EmploymentType = require('../src/modules/organization/models/employmenttype');
const Employee = require('../src/modules/auth/models/employee');
const service = require('../src/modules/organization/services/employmenttypeservice');
const organizationId = '507f1f77bcf86cd799439011';
const id = '507f1f77bcf86cd799439012';
function company(t) { t.mock.method(Organization, 'findOne', async () => ({ _id: organizationId })); }

test('employment type creation validates boolean status and attaches company', async (t) => {
  company(t);
  t.mock.method(EmploymentType, 'create', async (value) => value);
  const type = await service.createEmploymentType({ name: 'Intern', code: 'intern', isActive: false });
  assert.equal(type.organizationId, organizationId);
  assert.equal(type.code, 'INTERN');
  assert.equal(type.isActive, false);
  await assert.rejects(service.createEmploymentType({ name: 'Intern', code: 'INTERN', isActive: 'false' }), { statusCode: 400 });
  await assert.rejects(service.createEmploymentType({ name: 'Intern', code: 'INTERN', organizationId }), { statusCode: 400 });
  await assert.rejects(service.createEmploymentType({ name: '' }), { statusCode: 400 });
});

test('list filters active/inactive and escapes search with pagination', async (t) => {
  company(t);
  let filter;
  const chain = { sort() { return this; }, skip() { return this; }, limit() { return this; }, lean: async () => [] };
  t.mock.method(EmploymentType, 'find', (value) => { filter = value; return chain; });
  t.mock.method(EmploymentType, 'countDocuments', async () => 0);
  const result = await service.listEmploymentTypes({ status: 'inactive', search: 'a.*' });
  assert.equal(filter.isActive, false);
  assert.equal(filter.organizationId, organizationId);
  assert.equal(filter.$or[0].name.$regex, 'a\\.\\*');
  assert.deepEqual(result.pagination, { page: 1, limit: 20, total: 0, totalPages: 0 });
  await assert.rejects(service.listEmploymentTypes({ status: 'active', isActive: 'false' }), { statusCode: 400 });
});

test('employment type saves accept status and store only isActive', async (t) => {
  company(t);
  t.mock.method(EmploymentType, 'create', async (value) => value);
  for (const status of ['active', 'inactive']) {
    const type = await service.createEmploymentType({ name: 'Intern', code: 'INTERN', status });
    assert.equal(type.isActive, status === 'active');
    assert.equal(Object.hasOwn(type, 'status'), false);
  }
  const type = { isActive: true, save: async () => type };
  t.mock.method(EmploymentType, 'findOne', async () => type);
  await service.updateEmploymentType(id, { status: 'inactive' });
  assert.equal(type.isActive, false);
  assert.equal(Object.hasOwn(type, 'status'), false);
  await service.updateEmploymentType(id, { status: 'active', isActive: true });
  assert.equal(type.isActive, true);
  for (const body of [{ status: 'active', isActive: false }, { status: 'deleted' }, { status: '' }, { status: null }]) {
    await assert.rejects(service.updateEmploymentType(id, body), { statusCode: 400 });
  }
});

test('default initialization only inserts missing categories and preserves existing configuration', async (t) => {
  company(t);
  const codes = [];
  t.mock.method(EmploymentType, 'updateOne', async (filter, update, options) => {
    codes.push(filter.code);
    assert.equal(filter.organizationId, organizationId);
    assert.deepEqual(Object.keys(update), ['$setOnInsert']);
    assert.equal(update.$setOnInsert.isActive, true);
    assert.ok(update.$setOnInsert.createdAt instanceof Date);
    assert.equal(options.upsert, true);
  });
  t.mock.method(EmploymentType, 'find', () => ({ sort() { return this; }, lean: async () => [] }));
  await service.initializeDefaults();
  assert.deepEqual(codes, ['INTERN', 'PROBATION', 'PERMANENT']);
});

test('editing classification preserves employee references and inactive types reject assignments', async (t) => {
  company(t);
  const type = { _id: id, name: 'Intern', code: 'INTERN', isActive: true, save: async () => type };
  const lookup = t.mock.method(EmploymentType, 'findOne', async () => type);
  const employee = { save: async () => {}, populate: async () => employee };
  t.mock.method(Employee, 'findById', async () => employee);
  await service.assignEmploymentType(id, { employmentTypeId: id });
  assert.equal(employee.employmentTypeId, id);
  assert.equal(employee.employmentType, 'intern');
  await service.updateEmploymentType(id, { name: 'Internship', isActive: false });
  assert.equal(employee.employmentTypeId, id);
  await assert.rejects(service.assignEmploymentType(id, { employmentTypeId: id }), { statusCode: 400 });
  await assert.rejects(service.resolveEmploymentType('bad'), { statusCode: 400 });
  await assert.rejects(service.assignEmploymentType(id, { employmentTypeId: null }), { statusCode: 400 });
  lookup.mock.mockImplementation(async () => null);
  await assert.rejects(service.resolveEmploymentType(id), { statusCode: 404 });
  assert.equal(service.legacyValue({ code: 'PERMANENT' }), 'full-time');
  assert.equal(service.legacyValue({ code: 'CONTRACT' }), 'contract');
});

test('employment type routes exist, enforce HR access and return expected responses', async (t) => {
  t.mock.method(service, 'listEmploymentTypes', async () => ({ employmentTypes: [], pagination: { total: 0 } }));
  t.mock.method(service, 'createEmploymentType', async () => ({ _id: id, name: 'Intern' }));
  t.mock.method(service, 'updateEmploymentType', async () => ({ _id: id, isActive: false }));
  t.mock.method(service, 'initializeDefaults', async () => [{ code: 'INTERN' }, { code: 'PROBATION' }, { code: 'PERMANENT' }]);
  t.mock.method(service, 'assignEmploymentType', async () => ({ employmentTypeId: id }));
  const server = await new Promise((resolve) => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const paths = [['GET', '/api/employment-types', 200, 'employmentTypes'], ['POST', '/api/employment-types', 201, 'employmentType'], ['PATCH', `/api/employment-types/${id}`, 200, 'employmentType'], ['POST', '/api/employment-types/defaults', 200, 'employmentTypes'], ['PATCH', `/api/employees/${id}/employment-type`, 200, 'employee']];
  for (const [method, path, status, key] of paths) {
    for (const role of [null, 'employee', 'hr', 'admin']) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method, headers: role ? { Authorization: `Bearer ${jwt.sign({ role }, process.env.JWT_SECRET)}` } : {} });
      assert.equal(response.status, !role ? 401 : role === 'employee' ? 403 : status);
      if (['hr', 'admin'].includes(role)) assert.ok(Object.hasOwn(await response.json(), key));
    }
  }
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'employee-details-test-secret';

const app = require('../src/app');
const Employee = require('../src/modules/auth/models/employee');
const service = require('../src/modules/employees/services/employeeservice');
const id = '507f1f77bcf86cd799439011';

test('employee details expose the linked user role without duplicating stored roles', async (t) => {
  let employee;
  t.mock.method(Employee, 'findById', () => ({
    populate(relations) {
      assert.equal(relations.find((item) => item.path === 'user').select, 'email role status');
      return this;
    },
    lean: async () => employee,
  }));

  for (const role of ['employee', 'tech_lead', 'department_manager', 'hr', 'admin']) {
    employee = { _id: id, user: { role, status: 'active' }, onboardingStatus: 'pending' };
    const result = await service.getEmployee(id);
    assert.equal(result.role, role);
    assert.equal(result.onboardingStatus, 'completed');
  }

  employee = { _id: id, user: null, onboardingStatus: 'pending' };
  assert.equal((await service.getEmployee(id)).role, null);
  employee = null;
  await assert.rejects(service.getEmployee(id), { statusCode: 404 });
  await assert.rejects(service.getEmployee('bad'), { statusCode: 400 });
});

test('employee listing and detail view use the same role field', async (t) => {
  t.mock.method(Employee, 'find', () => ({
    sort() { return this; },
    populate() { return this; },
    lean: async () => [{ _id: id, user: { role: 'tech_lead', status: 'invited' }, onboardingStatus: 'pending' }],
  }));
  const [employee] = await service.listEmployees();
  assert.equal(employee.role, 'tech_lead');
  assert.equal(employee.user.role, 'tech_lead');
  assert.equal(employee.onboardingStatus, 'pending');
});

test('employee detail route restricts personal details to HR/admin', async (t) => {
  t.mock.method(Employee, 'findById', () => ({
    populate() { return this; },
    lean: async () => ({ _id: id, user: { role: 'department_manager', status: 'active' } }),
  }));
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));

  for (const role of [null, 'employee', 'tech_lead', 'department_manager', 'hr', 'admin']) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/employees/${id}`, {
      headers: role ? { Authorization: `Bearer ${jwt.sign({ role }, process.env.JWT_SECRET)}` } : {},
    });
    assert.equal(response.status, !role ? 401 : ['hr', 'admin'].includes(role) ? 200 : 403);
    if (response.status === 200) {
      assert.equal((await response.json()).employee.role, 'department_manager');
    }
  }
});

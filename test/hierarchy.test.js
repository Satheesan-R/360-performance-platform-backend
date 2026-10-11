const { test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
process.env.JWT_SECRET = 'hierarchy-test-secret';
const app = require('../src/app');
const Employee = require('../src/modules/auth/models/employee');
const Organization = require('../src/modules/organization/models/organization');
const service = require('../src/modules/organization/services/hierarchyservice');
const org = '507f1f77bcf86cd799439010';
const a = '507f1f77bcf86cd799439011';
const b = '507f1f77bcf86cd799439012';
const c = '507f1f77bcf86cd799439013';

test('manager validation rejects self-reporting, direct/indirect cycles, missing and foreign managers', async (t) => {
  const records = new Map([
    [a, { _id: a, organizationId: org, managerId: null }],
    [b, { _id: b, organizationId: org, managerId: a }],
    [c, { _id: c, organizationId: org, managerId: b }],
  ]);
  t.mock.method(Employee, 'findById', (id) => ({ session: async () => records.get(String(id)) || null }));
  await assert.rejects(service.validateManager(a, a, org, {}), { statusCode: 400 });
  await assert.rejects(service.validateManager(a, b, org, {}), { statusCode: 400 });
  await assert.rejects(service.validateManager(a, c, org, {}), { statusCode: 400 });
  records.get(b).managerId = c;
  await assert.rejects(service.validateManager(a, b, org, {}), { statusCode: 400 });
  records.get(b).managerId = null;
  records.get(b).organizationId = c;
  await assert.rejects(service.validateManager(a, b, org, {}), { statusCode: 400 });
  records.delete(b);
  await assert.rejects(service.validateManager(a, b, org, {}), { statusCode: 404 });
  assert.equal(await service.validateManager(a, null, org, {}), null);
});

test('manager assignments lock the company within the transaction and support clearing', async (t) => {
  const session = {};
  t.mock.method(mongoose.connection, 'transaction', async (operation) => operation(session));
  t.mock.method(Organization, 'findOneAndUpdate', async (filter, update, options) => {
    assert.deepEqual(filter, { singletonKey: 'company' });
    assert.deepEqual(update, { $inc: { hierarchyVersion: 1 } });
    assert.equal(options.session, session);
    return { _id: org };
  });
  const records = new Map([
    [a, { _id: a, organizationId: null, managerId: null }],
    [b, { _id: b, organizationId: org, managerId: null, firstName: 'Priya', lastName: 'Kumar' }],
  ]);
  t.mock.method(Employee, 'findById', (id) => ({ session: async () => records.get(id), populate: async () => records.get(id) }));
  t.mock.method(Employee, 'updateOne', async (filter, update, options) => {
    assert.equal(options.session, session);
    Object.assign(records.get(filter._id), update.$set);
  });
  await service.assignManager(a, { managerId: b });
  assert.equal(records.get(a).managerId, b);
  assert.equal(records.get(a).organizationId, org);
  assert.equal(records.get(a).manager, 'Priya Kumar');
  await service.assignManager(a, { managerId: null });
  assert.equal(records.get(a).managerId, null);
  assert.equal(records.get(a).manager, '');
  await assert.rejects(service.assignManager(a, { managerId: a }), { statusCode: 400 });
  await assert.rejects(service.assignManager(a, { managerId: 'bad' }), { statusCode: 400 });
  await assert.rejects(service.assignManager(a, { managerId: b, role: 'admin' }), { statusCode: 400 });
  records.get(a).organizationId = c;
  await assert.rejects(service.assignManager(a, { managerId: b }), { statusCode: 400 });
});

test('hierarchy response supplies chart roots and searchable employees', async (t) => {
  t.mock.method(Organization, 'findOne', async () => ({ _id: org }));
  let filter;
  const chain = {
    select() { return this; }, sort() { return this; }, populate() { return this; },
    lean: async () => [
      { _id: a, firstName: 'Priya', lastName: 'Kumar', employeeNumber: 'EMP-1', managerId: null },
      { _id: b, firstName: 'John', lastName: 'Doe', employeeNumber: 'EMP-2', jobTitle: 'Engineer', managerId: { _id: a } },
    ],
  };
  t.mock.method(Employee, 'find', (value) => { filter = value; return chain; });
  const result = await service.listHierarchy({ search: 'john doe' });
  assert.deepEqual(filter, { $or: [{ organizationId: org }, { organizationId: null }] });
  assert.equal(result.employees.length, 1);
  assert.equal(result.employees[0]._id, b);
  assert.deepEqual(result.rootEmployeeIds, [a]);
  assert.equal(result.total, 2);
  await assert.rejects(service.listHierarchy({ search: {} }), { statusCode: 400 });
});

test('hierarchy routes enforce access and return employee and chart responses', async (t) => {
  t.mock.method(service, 'listHierarchy', async () => ({ employees: [], rootEmployeeIds: [], total: 0 }));
  t.mock.method(service, 'assignManager', async () => ({ _id: a, managerId: b }));
  const server = await new Promise((resolve) => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  for (const [method, path, key] of [
    ['GET', '/api/hierarchy', 'employees'],
    ['GET', '/api/organization/hierarchy', 'employees'],
    ['PATCH', `/api/employees/${a}/manager`, 'employee'],
    ['PATCH', `/api/hierarchy/${a}/manager`, 'employee'],
  ]) {
    for (const role of [null, 'employee', 'hr', 'admin']) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method, headers: role ? { Authorization: `Bearer ${jwt.sign({ role }, process.env.JWT_SECRET)}` } : {} });
      assert.equal(response.status, !role ? 401 : role === 'employee' ? 403 : 200);
      if (['hr', 'admin'].includes(role)) assert.ok(Object.hasOwn(await response.json(), key));
    }
  }
});

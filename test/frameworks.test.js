const { test } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
process.env.JWT_SECRET = 'framework-tests-secret';
const app = require('../src/app');
const Framework = require('../src/modules/performance-framework/models/performanceframework');
const Organization = require('../src/modules/organization/models/organization');
const EmploymentType = require('../src/modules/organization/models/employmenttype');
const User = require('../src/modules/auth/models/usermodel');
const service = require('../src/modules/performance-framework/services/frameworkservice');
const org = '507f1f77bcf86cd799439011';
const id = '507f1f77bcf86cd799439012';
const user = '507f1f77bcf86cd799439013';
function company(t) { t.mock.method(Organization, 'findOne', async () => ({ _id: org })); }

test('framework writes validate statuses, job titles, references and server-owned fields', () => {
  assert.deepEqual(service.parseFields({ name: ' Engineering ', applicableJobRoles: [' Software Engineer '], applicableEmploymentTypeIds: [id] }, true), {
    name: 'Engineering', applicableJobRoles: ['Software Engineer'], applicableEmploymentTypeIds: [id],
  });
  for (const body of [null, [], {}, { name: '' }, { status: 'inactive' }, { createdBy: user }, { organizationId: org },
    { applicableEmploymentTypeIds: ['bad'] }, { applicableEmploymentTypeIds: [id, id.toUpperCase()] },
    { applicableJobRoles: ['Engineer', 'engineer'] }, { applicableJobRoles: [null] }, { description: 'a'.repeat(2001) }]) {
    assert.throws(() => service.parseFields(body), { statusCode: 400 });
  }
  assert.throws(() => service.parseFields({ description: 'Description' }, true), { statusCode: 400 });
  assert.deepEqual(service.parseFields({ applicableJobRoles: [], applicableEmploymentTypeIds: [] }), { applicableJobRoles: [], applicableEmploymentTypeIds: [] });
});

test('framework create records authenticated creator and validates company employment types', async (t) => {
  company(t);
  const userExists = t.mock.method(User, 'exists', async (filter) => { assert.equal(filter._id, user); assert.equal(filter.status, 'active'); return true; });
  const types = t.mock.method(EmploymentType, 'countDocuments', async (filter) => {
    assert.equal(filter.organizationId, org);
    assert.equal(filter.isActive, true);
    return 1;
  });
  t.mock.method(Framework, 'create', async (data) => ({ ...data, populate: async () => {}, toObject: () => data }));
  const framework = await service.createFramework({ name: 'Engineering', applicableEmploymentTypeIds: [id] }, user);
  assert.equal(framework.organizationId, org);
  assert.equal(framework.createdBy, user);
  assert.equal(framework.competencyCount, 0);
  assert.equal(framework.kpiCount, 0);
  assert.equal(framework.ratingScale, null);
  types.mock.mockImplementation(async () => 0);
  await assert.rejects(service.createFramework({ name: 'Engineering', applicableEmploymentTypeIds: [id] }, user), { statusCode: 400 });
  userExists.mock.mockImplementation(async () => false);
  await assert.rejects(service.createFramework({ name: 'Engineering' }, user), { statusCode: 403 });
});

test('framework listing filters status and literal search with pagination', async (t) => {
  company(t);
  let filter;
  const chain = { sort() { return this; }, skip(value) { assert.equal(value, 10); return this; }, limit(value) { assert.equal(value, 10); return this; }, populate() { return this; }, lean: async () => [{ _id: id, name: 'Engineering' }] };
  t.mock.method(Framework, 'find', (value) => { filter = value; return chain; });
  t.mock.method(Framework, 'countDocuments', async () => 11);
  const result = await service.listFrameworks({ search: 'a.*', status: 'active', employmentTypeId: id, page: '2', limit: '10' });
  assert.equal(filter.organizationId, org);
  assert.equal(filter.status, 'active');
  assert.equal(filter.applicableEmploymentTypeIds, id);
  assert.equal(filter.$or[0].name.$regex, 'a\\.\\*');
  assert.equal(result.frameworks[0].competencyCount, 0);
  assert.deepEqual(result.pagination, { page: 2, limit: 10, total: 11, totalPages: 2 });
  await assert.rejects(service.listFrameworks({ status: 'deleted' }), { statusCode: 400 });
});

test('framework detail and archive updates scope organization and reject missing records', async (t) => {
  company(t);
  const detail = t.mock.method(Framework, 'findOne', (filter) => {
    assert.equal(filter.organizationId, org);
    return { populate() { return this; }, lean: async () => ({ _id: id, organizationId: org, __v: 0, name: 'Engineering' }) };
  });
  assert.equal((await service.getFramework(id)).name, 'Engineering');
  const update = t.mock.method(Framework, 'findOneAndUpdate', (filter, data, options) => {
    assert.deepEqual(filter, { _id: id, organizationId: org, __v: 0 });
    assert.deepEqual(data, { $set: { status: 'archived' }, $inc: { __v: 1 } });
    assert.equal(options.runValidators, true);
    return { populate: async () => ({ _id: id, status: 'archived' }) };
  });
  assert.equal((await service.updateFramework(id, { status: 'archived' })).status, 'archived');
  update.mock.mockImplementation(() => ({ populate: async () => null }));
  await assert.rejects(service.updateFramework(id, { status: 'draft' }), { statusCode: 409 });
  detail.mock.mockImplementation(() => ({ populate() { return this; }, lean: async () => null }));
  await assert.rejects(service.getFramework(id), { statusCode: 404 });
  await assert.rejects(service.getFramework('bad'), { statusCode: 400 });
});

test('summary counts statuses and company setup is required', async (t) => {
  const lookup = t.mock.method(Organization, 'findOne', async () => ({ _id: org }));
  t.mock.method(Framework, 'countDocuments', async (filter) => ({ draft: 2, active: 1, archived: 3 })[filter.status]);
  assert.deepEqual(await service.getSummary(), { total: 6, draft: 2, active: 1, archived: 3 });
  lookup.mock.mockImplementation(async () => null);
  await assert.rejects(service.listFrameworks({}), { statusCode: 409 });
});

test('framework APIs enforce HR/admin access and derive creator from login token', async (t) => {
  t.mock.method(service, 'listFrameworks', async () => ({ frameworks: [], pagination: { total: 0 } }));
  t.mock.method(service, 'getSummary', async () => ({ total: 0 }));
  t.mock.method(service, 'getFramework', async () => ({ _id: id }));
  t.mock.method(service, 'updateFramework', async () => ({ _id: id, status: 'archived' }));
  t.mock.method(service, 'createFramework', async (body, creator) => { assert.equal(creator, user); return { _id: id, createdBy: creator }; });
  const server = await new Promise((resolve) => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  for (const [method, path, key, status] of [
    ['GET', '/api/performance-frameworks', 'frameworks', 200],
    ['GET', '/api/performance-frameworks/summary', 'summary', 200],
    ['GET', `/api/performance-frameworks/${id}`, 'framework', 200],
    ['POST', '/api/performance-frameworks', 'framework', 201],
    ['PATCH', `/api/performance-frameworks/${id}`, 'framework', 200],
  ]) {
    for (const role of [null, 'employee', 'hr', 'admin']) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method, headers: role ? { Authorization: `Bearer ${jwt.sign({ id: user, role }, process.env.JWT_SECRET)}` } : {} });
      assert.equal(response.status, !role ? 401 : role === 'employee' ? 403 : status);
      if (['hr', 'admin'].includes(role)) assert.ok(Object.hasOwn(await response.json(), key));
    }
  }
});

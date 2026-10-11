const { test } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
process.env.JWT_SECRET = 'teams-test-secret';
const app = require('../src/app');
const Organization = require('../src/modules/organization/models/organization');
const Department = require('../src/modules/organization/models/department');
const Employee = require('../src/modules/auth/models/employee');
const Team = require('../src/modules/organization/models/team');
const service = require('../src/modules/organization/services/teamservice');
const organizationId = '507f1f77bcf86cd799439011';
const departmentId = '507f1f77bcf86cd799439012';
const teamId = '507f1f77bcf86cd799439013';

function mockCompany(t) {
  t.mock.method(Organization, 'findOne', async () => ({ _id: organizationId }));
}

test('team creation validates fields, company, department and lead', async (t) => {
  const company = t.mock.method(Organization, 'findOne', async () => null);
  const body = { name: 'Frontend', code: 'eng-fe', departmentId };
  await assert.rejects(service.createTeam({ ...body, organizationId }), { statusCode: 400 });
  await assert.rejects(service.createTeam({ ...body, departmentId: null }), { statusCode: 400 });
  await assert.rejects(service.createTeam(body), { statusCode: 409 });
  company.mock.mockImplementation(async () => ({ _id: organizationId }));
  const department = t.mock.method(Department, 'findById', async () => null);
  await assert.rejects(service.createTeam(body), { statusCode: 404 });
  department.mock.mockImplementation(async () => ({ organizationId: teamId, status: 'active' }));
  await assert.rejects(service.createTeam(body), { statusCode: 400 });
  department.mock.mockImplementation(async () => ({ organizationId, status: 'inactive' }));
  await assert.rejects(service.createTeam(body), { statusCode: 400 });
  department.mock.mockImplementation(async () => ({ organizationId, status: 'active' }));
  t.mock.method(Employee, 'exists', async () => null);
  await assert.rejects(service.createTeam({ ...body, teamLeadEmployeeId: teamId }), { statusCode: 404 });
  t.mock.method(Team, 'create', async (data) => ({ populate: async () => data }));
  const team = await service.createTeam({ ...body, teamLeadEmployeeId: null });
  assert.equal(team.organizationId, organizationId);
  assert.equal(team.code, 'ENG-FE');
  assert.equal(team.teamLeadEmployeeId, null);
});

test('team updates allow deactivation but reject reactivation under inactive departments', async (t) => {
  mockCompany(t);
  const team = { departmentId, status: 'active', teamLeadEmployeeId: teamId, save: async () => {}, populate: async () => team };
  const lookup = t.mock.method(Team, 'findOne', async () => team);
  t.mock.method(Department, 'findById', async () => ({ organizationId, status: 'inactive' }));
  await service.updateTeam(teamId, { status: 'inactive', teamLeadEmployeeId: null });
  assert.equal(team.status, 'inactive');
  assert.equal(team.teamLeadEmployeeId, null);
  await assert.rejects(service.updateTeam(teamId, { status: 'active' }), { statusCode: 400 });
  await assert.rejects(service.updateTeam(teamId, {}), { statusCode: 400 });
  await assert.rejects(service.updateTeam('bad', { name: 'Frontend' }), { statusCode: 400 });
  lookup.mock.mockImplementation(async () => null);
  await assert.rejects(service.updateTeam(teamId, { name: 'Frontend' }), { statusCode: 404 });
});

test('team listing scopes company, filters department and escapes search', async (t) => {
  mockCompany(t);
  let filter;
  const query = {
    sort() { return this; }, skip(value) { assert.equal(value, 10); return this; },
    limit(value) { assert.equal(value, 10); return this; }, populate() { return this; },
    async lean() { return [{ _id: teamId, name: 'Frontend' }]; },
  };
  t.mock.method(Team, 'find', (value) => { filter = value; return query; });
  t.mock.method(Team, 'countDocuments', async () => 11);
  const result = await service.listTeams({ page: '2', limit: '10', departmentId, status: 'active', search: 'a.*' });
  assert.equal(filter.organizationId, organizationId);
  assert.equal(filter.departmentId, departmentId);
  assert.equal(filter.status, 'active');
  assert.equal(filter.$or[0].name.$regex, 'a\\.\\*');
  assert.deepEqual(result.pagination, { page: 2, limit: 10, total: 11, totalPages: 2 });
  await assert.rejects(service.listTeams({ departmentId: 'bad' }), { statusCode: 400 });
  await assert.rejects(service.listTeams({ status: 'deleted' }), { statusCode: 400 });
});

test('Teams HTTP routes enforce access and support list, create, update and conflicts', async (t) => {
  mockCompany(t);
  const team = { _id: teamId, organizationId, name: 'Frontend', departmentId, status: 'active', save: async () => {}, populate: async () => ({ _id: teamId, name: team.name }) };
  t.mock.method(Department, 'findById', async () => ({ organizationId, status: 'active' }));
  t.mock.method(Team, 'findOne', async () => team);
  const create = t.mock.method(Team, 'create', async () => team);
  const chain = { sort() { return this; }, skip() { return this; }, limit() { return this; }, populate() { return this; }, lean: async () => [{ _id: teamId, name: 'Frontend' }] };
  t.mock.method(Team, 'find', () => chain);
  t.mock.method(Team, 'countDocuments', async () => 1);
  const server = await new Promise((resolve) => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const request = (method, path, role, body) => fetch(`http://127.0.0.1:${server.address().port}${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...(role && { Authorization: `Bearer ${jwt.sign({ role }, process.env.JWT_SECRET)}` }) },
    ...(body && { body: JSON.stringify(body) }),
  });
  for (const [method, path] of [['GET', '/api/teams'], ['POST', '/api/teams'], ['PATCH', `/api/teams/${teamId}`]]) {
    assert.equal((await request(method, path)).status, 401);
    assert.equal((await request(method, path, 'employee')).status, 403);
  }
  const list = await request('GET', '/api/teams', 'hr');
  assert.equal(list.status, 200);
  assert.equal((await list.json()).teams.length, 1);
  const created = await request('POST', '/api/teams', 'admin', { name: 'Frontend', code: 'FE', departmentId });
  assert.equal(created.status, 201);
  assert.equal((await created.json()).team._id, teamId);
  assert.equal((await request('PATCH', `/api/teams/${teamId}`, 'hr', { name: 'Frontend Updated' })).status, 200);
  assert.equal((await request('PATCH', '/api/teams/bad', 'hr', { name: 'Frontend' })).status, 400);
  create.mock.mockImplementation(async () => { throw Object.assign(new Error('Duplicate'), { code: 11000 }); });
  t.mock.method(console, 'error', () => {});
  assert.equal((await request('POST', '/api/teams', 'hr', { name: 'Frontend', code: 'FE', departmentId })).status, 409);
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'department-structure-test-secret';

const app = require('../src/app');
const Organization = require('../src/modules/organization/models/organization');
const Department = require('../src/modules/organization/models/department');
const Team = require('../src/modules/organization/models/team');
const Employee = require('../src/modules/auth/models/employee');
const assignments = require('../src/modules/organization/services/structureassignments');
const queries = require('../src/modules/organization/services/structurequeries');
const departments = require('../src/modules/organization/services/departmentservice');
const teams = require('../src/modules/organization/services/teamservice');
const hierarchy = require('../src/modules/organization/services/departmenthierarchy');

const org = '507f1f77bcf86cd799439011';
const departmentId = '507f1f77bcf86cd799439012';
const teamId = '507f1f77bcf86cd799439013';
const employeeId = '507f1f77bcf86cd799439014';
const otherId = '507f1f77bcf86cd799439015';

function chain(value) {
  return {
    select() { return this; }, sort() { return this; }, skip() { return this; },
    limit() { return this; }, populate() { return this; },
    session: async () => value, lean: async () => value,
  };
}

function assignmentSetup(t) {
  const session = {};
  const state = {
    employee: { _id: employeeId, organizationId: org, departmentId, teamId: null },
    team: { _id: teamId, organizationId: org, departmentId, status: 'active' },
    department: { _id: departmentId, organizationId: org, status: 'active' },
  };

  t.mock.method(mongoose.connection, 'transaction', async (operation) => operation(session));
  t.mock.method(Organization, 'findOneAndUpdate', async (filter, update, options) => {
    assert.equal(options.session, session);
    assert.deepEqual(update, { $inc: { structureVersion: 1 } });
    return { _id: org };
  });
  t.mock.method(Employee, 'findById', () => {
    const result = chain(state.employee);
    return result;
  });
  t.mock.method(Team, 'findOne', () => chain(state.team));
  t.mock.method(Department, 'findOne', () => chain(state.department));
  t.mock.method(Employee, 'updateOne', async (filter, update, options) => {
    assert.equal(options.session, session);
    Object.assign(state.employee, update.$set);
  });

  return state;
}

test('hierarchy retains empty teams, assigned employees and employees with missing teams', () => {
  const result = hierarchy.groupHierarchy(
    { _id: departmentId },
    [{ _id: teamId, name: 'Frontend' }, { _id: otherId, name: 'Backend' }],
    [
      { _id: 'first', teamId: { _id: teamId } },
      { _id: 'second', teamId: null },
      { _id: 'third', teamId: employeeId },
    ]
  );

  assert.equal(result.teams[0].employeeCount, 1);
  assert.equal(result.teams[1].employeeCount, 0);
  assert.deepEqual(result.unassignedEmployees.map((employee) => employee.unassignedReason), ['no-team', 'team-not-in-department']);
  assert.deepEqual(result.summary, { teamCount: 2, employeeCount: 3, unassignedEmployeeCount: 2 });
});

test('team assignment rejects wrong departments, foreign employees and inactive relationships', async (t) => {
  const state = assignmentSetup(t);

  await assignments.assignTeam(employeeId, { teamId });
  assert.equal(state.employee.teamId, teamId);
  await assignments.assignTeam(employeeId, { teamId: null });
  assert.equal(state.employee.teamId, null);

  state.employee.departmentId = otherId;
  await assert.rejects(assignments.assignTeam(employeeId, { teamId }), { statusCode: 400 });
  state.employee.departmentId = departmentId;
  state.team.status = 'inactive';
  await assert.rejects(assignments.assignTeam(employeeId, { teamId }), { statusCode: 400 });
  state.team.status = 'active';
  state.department.status = 'inactive';
  await assert.rejects(assignments.assignTeam(employeeId, { teamId }), { statusCode: 400 });
  state.department.status = 'active';
  state.employee.organizationId = otherId;
  await assert.rejects(assignments.assignTeam(employeeId, { teamId }), { statusCode: 400 });
  await assert.rejects(assignments.assignTeam(employeeId, { teamId, role: 'admin' }), { statusCode: 400 });
});

test('department changes clear the previous team but saving the same department preserves it', async (t) => {
  const state = assignmentSetup(t);
  state.employee.teamId = teamId;

  await assignments.assignDepartment(employeeId, { departmentId });
  assert.equal(state.employee.teamId, teamId);
  state.department._id = otherId;
  await assignments.assignDepartment(employeeId, { departmentId: otherId });
  assert.equal(state.employee.departmentId, otherId);
  assert.equal(state.employee.teamId, null);

  state.employee.teamId = teamId;
  await assignments.assignDepartment(employeeId, { departmentId: null });
  assert.equal(state.employee.departmentId, null);
  assert.equal(state.employee.teamId, null);
});

test('moving a team with employees is rejected before any department change', async (t) => {
  const state = assignmentSetup(t);
  const save = t.mock.fn(async () => {});
  state.team.save = save;
  t.mock.method(Employee, 'exists', () => chain(true));

  await assert.rejects(teams.updateTeam(teamId, { departmentId: otherId }), { statusCode: 409 });
  assert.equal(save.mock.callCount(), 0);
});

test('department form aliases normalize to headEmployeeId and reject conflicting choices', () => {
  assert.deepEqual(departments.departmentFields({ departmentHeadId: employeeId }), { headEmployeeId: employeeId });
  assert.deepEqual(departments.departmentFields({ departmentHeadId: null }), { headEmployeeId: null });
  assert.throws(() => departments.departmentFields({ departmentHeadId: employeeId, headEmployeeId: otherId }), { statusCode: 400 });
});

test('detail and employee queries are company scoped and do not expose personal employee fields', async (t) => {
  t.mock.method(Organization, 'findOne', async () => ({ _id: org }));
  t.mock.method(Department, 'findOne', (filter) => {
    assert.deepEqual(filter, { _id: departmentId, organizationId: org });
    return chain({ _id: departmentId, name: 'Engineering' });
  });
  t.mock.method(Team, 'countDocuments', async () => 2);
  t.mock.method(Employee, 'countDocuments', async () => 3);
  const detail = await queries.getDepartment(departmentId);
  assert.equal(detail.employeeCount, 3);
  assert.equal(detail.teamCount, 2);

  t.mock.method(Employee, 'find', (filter) => {
    assert.ok(filter.$and);
    const query = chain([{ _id: employeeId }]);
    query.select = (fields) => {
      assert.doesNotMatch(fields, /personalEmail|dateOfBirth|address|phone/);
      return query;
    };
    return query;
  });
  const employees = await queries.departmentEmployees(departmentId, { search: 'a.*' });
  assert.equal(employees.pagination.total, 3);
});

test('department and team view endpoints enforce access and return UI response shapes', async (t) => {
  t.mock.method(Organization, 'findOne', async () => ({ _id: org }));
  t.mock.method(Department, 'findOne', () => chain({ _id: departmentId }));
  t.mock.method(Team, 'find', () => chain([]));
  t.mock.method(Employee, 'find', () => chain([]));
  t.mock.method(queries, 'getDepartment', async () => ({ _id: departmentId, name: 'Engineering' }));
  t.mock.method(queries, 'getTeam', async () => ({ _id: teamId, name: 'Frontend' }));
  t.mock.method(queries, 'departmentEmployees', async () => ({ employees: [], pagination: { total: 0 } }));
  t.mock.method(queries, 'teamEmployees', async () => ({ employees: [], pagination: { total: 0 } }));
  t.mock.method(departments, 'departmentSummary', async () => ({ total: 4, active: 3, inactive: 1 }));
  t.mock.method(departments, 'updateDepartment', async (id, body) => ({ _id: id, status: body.status }));
  t.mock.method(teams, 'listTeams', async () => ({ teams: [], pagination: { total: 0 } }));
  t.mock.method(assignments, 'assignTeam', async () => ({ _id: employeeId, teamId }));

  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));

  for (const [method, path, key] of [
    ['GET', '/api/departments/summary', 'summary'],
    ['GET', `/api/departments/${departmentId}`, 'department'],
    ['GET', `/api/departments/${departmentId}/teams`, 'teams'],
    ['GET', `/api/departments/${departmentId}/employees`, 'employees'],
    ['GET', `/api/departments/${departmentId}/hierarchy`, 'teams'],
    ['GET', `/api/teams/${teamId}`, 'team'],
    ['GET', `/api/teams/${teamId}/employees`, 'employees'],
    ['PATCH', `/api/employees/${employeeId}/team`, 'employee'],
    ['DELETE', `/api/departments/${departmentId}`, 'department'],
  ]) {
    for (const role of [null, 'employee', 'hr', 'admin']) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
        method,
        headers: role ? { Authorization: `Bearer ${jwt.sign({ role }, process.env.JWT_SECRET)}` } : {},
      });

      assert.equal(response.status, !role ? 401 : role === 'employee' ? 403 : 200);
      if (['hr', 'admin'].includes(role)) {
        assert.ok(Object.hasOwn(await response.json(), key));
      }
    }
  }
});

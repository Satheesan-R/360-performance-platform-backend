const { test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
process.env.JWT_SECRET = 'goals-test-secret';
const app = require('../src/app');
const service = require('../src/modules/goals/services/goalservice');
const access = require('../src/modules/goals/services/access');
const v = require('../src/modules/goals/services/validation');
const GoalPlan = require('../src/modules/goals/models/goalplan');
const Goal = require('../src/modules/goals/models/goal');
const KeyResult = require('../src/modules/goals/models/keyresult');
const GoalCheckIn = require('../src/modules/goals/models/goalcheckin');
const User = require('../src/modules/auth/models/usermodel');
const Employee = require('../src/modules/auth/models/employee');
const Organization = require('../src/modules/organization/models/organization');
const Team = require('../src/modules/organization/models/team');
const Department = require('../src/modules/organization/models/department');

const id = (n) => n.toString(16).padStart(24, '0');
const orgId = id(1), planId = id(2), goalId = id(3), keyId = id(4), userId = id(5), employeeId = id(6), teamId = id(7), otherId = id(8);
const auth = { id: userId, role: 'employee' };

// Query-shaped stubs exercise the real services and HTTP middleware without a database.
function query(value) {
  return {
    session() { return this; }, select() { return this; }, sort() { return this; },
    skip() { return this; }, limit() { return this; }, lean() { return this; },
    then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); },
  };
}

function fixture(t, role = 'hr') {
  const session = { testSession: true };
  const user = { _id: userId, role, status: 'active', employee: employeeId };
  const employee = { _id: employeeId, organizationId: orgId, teamId };
  const plan = { _id: planId, organizationId: orgId, name: 'Q1', status: 'draft',
    startDate: new Date('2027-01-01'), endDate: new Date('2027-03-31'),
    async save(options) { assert.equal(options.session, session); } };
  const goal = { _id: goalId, organizationId: orgId, planId, level: 'individual',
    ownerEmployeeId: employeeId, teamId, status: 'draft', title: 'Support',
    async save(options) { assert.equal(options.session, session); } };
  const key = { _id: keyId, organizationId: orgId, planId, goalId, title: 'Tickets', type: 'increase',
    startValue: 0, targetValue: 100, currentValue: 0, checkInCount: 0,
    async save(options) { assert.equal(options.session, session); } };
  t.mock.method(User, 'findById', () => query(user));
  t.mock.method(User, 'exists', () => query({ _id: userId }));
  t.mock.method(Employee, 'findById', () => query(employee));
  t.mock.method(Employee, 'find', () => query([{ _id: employeeId }]));
  t.mock.method(Organization, 'findOne', () => query({ _id: orgId }));
  t.mock.method(Team, 'find', () => query([]));
  t.mock.method(Team, 'findOne', () => query({ _id: teamId, organizationId: orgId, teamLeadEmployeeId: employeeId }));
  t.mock.method(Department, 'find', () => query([]));
  t.mock.method(GoalPlan, 'findOne', () => query(plan));
  t.mock.method(Goal, 'findOne', () => query(goal));
  t.mock.method(KeyResult, 'findOne', () => query(key));
  t.mock.method(KeyResult, 'find', () => query([key]));
  const transaction = t.mock.method(mongoose.connection, 'transaction', async (operation) => operation(session));
  const lock = t.mock.method(GoalPlan, 'findOneAndUpdate', async (filter, update, options) => {
    assert.equal(String(filter.organizationId), orgId);
    assert.deepEqual(update, { $inc: { writeVersion: 1 } });
    assert.equal(options.session, session);
    return plan;
  });
  return { user, employee, plan, goal, key, session, transaction, lock };
}

test('numeric progress handles increasing/decreasing metrics, regressions, overshoot and averaging', () => {
  assert.equal(v.progress({ type: 'increase', startValue: 10, targetValue: 30, currentValue: 20 }), 50);
  assert.equal(v.progress({ type: 'decrease', startValue: 48, targetValue: 24, currentValue: 36 }), 50);
  assert.equal(v.progress({ type: 'increase', startValue: 10, targetValue: 30, currentValue: 5 }), 0);
  assert.equal(v.progress({ type: 'decrease', startValue: 48, targetValue: 24, currentValue: 10 }), 100);
  assert.equal(v.progress({ type: 'milestone', currentValue: 0 }), 0);
  assert.equal(v.progress({ type: 'milestone', currentValue: 1 }), 100);
  assert.equal(v.goalProgress([]), 0);
  assert.equal(v.goalProgress([{ type: 'milestone', currentValue: 1 }, { type: 'milestone', currentValue: 0 }]), 50);
  const almost = { type: 'increase', startValue: 0, targetValue: 100, currentValue: 99.9999 };
  assert.equal(v.progress(almost), 100);
  assert.equal(v.achieved(almost), false, 'Rounding must not allow early completion');
});

test('input validation rejects mass assignment, impossible dates, invalid IDs and unusable targets', () => {
  for (const body of [null, [], {}, { progress: 100 }]) assert.throws(() => v.goalInput(body), { statusCode: 400 });
  assert.throws(() => v.planInput({ name: 'Q1', startDate: '2027-02-30', endDate: '2027-03-01' }, true), { statusCode: 400 });
  assert.throws(() => v.planInput({ name: 'Q1', startDate: '2027-1-01', endDate: '2027-03-01' }, true), { statusCode: 400 });
  assert.throws(() => v.goalInput({ planId: 'bad', title: 'Goal', level: 'individual', ownerEmployeeId: employeeId }, true), { statusCode: 400 });
  for (const data of [
    { type: 'increase', startValue: 10, targetValue: 10 },
    { type: 'decrease', startValue: 10, targetValue: 20 },
    { type: 'increase', startValue: 0, targetValue: '100' },
    { type: 'increase', startValue: NaN, targetValue: 100 },
    { type: 'increase', startValue: 0, targetValue: Infinity },
    { type: 'milestone', startValue: 0, targetValue: 100 },
  ]) assert.throws(() => v.validateMetric(data), { statusCode: 400 });
  assert.deepEqual(v.validateMetric({ type: 'milestone' }), { type: 'milestone', startValue: 0, targetValue: 1 });
  assert.throws(() => v.pagination({ limit: '101' }), { statusCode: 400 });
});

test('goal access rechecks account status and database role instead of trusting token role', async (t) => {
  const f = fixture(t, 'employee');
  await assert.rejects(service.createPlan({ ...auth, role: 'admin' }, { name: 'Q1', startDate: '2027-01-01', endDate: '2027-03-31' }), { statusCode: 403 });
  f.user.status = 'disabled';
  await assert.rejects(service.listPlans(auth), { statusCode: 401 });
  await assert.rejects(service.listPlans({ ...auth, purpose: 'activation' }), { statusCode: 401 });
  await assert.rejects(service.listPlans({ role: 'admin' }), { statusCode: 401 });
  f.user.status = 'active';
  f.user.employee = null;
  await assert.rejects(service.listPlans(auth), { statusCode: 403 });
  f.user.role = 'hr';
  t.mock.method(GoalPlan, 'find', () => query([]));
  t.mock.method(GoalPlan, 'countDocuments', async () => 0);
  assert.deepEqual((await service.listPlans(auth)).plans, []);
});

test('manager visibility is restricted to led teams, headed departments and reporting employees', async (t) => {
  const f = fixture(t, 'department_manager');
  const deptId = id(9), subordinateId = id(10);
  let teamFilter, employeeFilter;
  t.mock.method(Department, 'find', (filter) => {
    assert.equal(filter.headEmployeeId, employeeId);
    return query([{ _id: deptId }]);
  });
  t.mock.method(Team, 'find', (filter) => { teamFilter = filter; return query([{ _id: teamId }]); });
  t.mock.method(Employee, 'find', (filter) => { employeeFilter = filter; return query([{ _id: employeeId }, { _id: subordinateId }]); });
  const ctx = await access.context(auth);
  assert.equal(teamFilter.organizationId, orgId);
  assert.deepEqual(teamFilter.$or[1], { departmentId: { $in: [deptId] } });
  assert.ok(employeeFilter.$and[1].$or.some((filter) => filter.managerId === employeeId));
  assert.equal(access.canManage(ctx, { ...f.goal, ownerEmployeeId: subordinateId }), true);
  assert.equal(access.canManage(ctx, { ...f.goal, ownerEmployeeId: otherId }), false);
  assert.equal(access.canManage(ctx, { ...f.goal, level: 'team' }), true);
  assert.equal(access.canManage(ctx, { ...f.goal, level: 'team', teamId: otherId }), false);
  assert.equal(access.canManage(ctx, { ...f.goal, level: 'organization' }), false);
  assert.equal(access.canManage(ctx, { ...f.goal, organizationId: otherId }), false);
});

test('plan lifecycle permits draft dates, locks dates after activation and preserves closed history', async (t) => {
  const f = fixture(t);
  const create = t.mock.method(GoalPlan, 'create', async (data) => data);
  const plan = await service.createPlan(auth, { name: ' Q1 ', startDate: '2027-01-01', endDate: '2027-03-31' });
  assert.equal(plan.name, 'Q1');
  assert.equal(plan.createdBy, userId);
  assert.equal(plan.organizationId, orgId);
  assert.equal(create.mock.callCount(), 1);
  await assert.rejects(service.createPlan(auth, { name: 'Q1', startDate: '2027-04-01', endDate: '2027-03-31' }), { statusCode: 400 });
  await service.updatePlan(auth, planId, { endDate: '2027-04-01' });
  await service.updatePlan(auth, planId, { status: 'active' });
  await assert.rejects(service.updatePlan(auth, planId, { startDate: '2027-01-02' }), { statusCode: 409 });
  await assert.rejects(service.updatePlan(auth, planId, { status: 'draft' }), { statusCode: 409 });
  await service.updatePlan(auth, planId, { status: 'closed' });
  await assert.rejects(service.updatePlan(auth, planId, { name: 'Changed', status: 'archived' }), { statusCode: 409 });
  await assert.rejects(service.updatePlan(auth, planId, { status: 'active' }), { statusCode: 409 });
  await service.updatePlan(auth, planId, { status: 'archived' });
  await assert.rejects(service.updatePlan(auth, planId, { name: 'Changed' }), { statusCode: 409 });
  assert.equal(f.plan.status, 'archived');
});

test('goal creation validates ownership, active accounts and team membership', async (t) => {
  const f = fixture(t, 'employee');
  const create = t.mock.method(Goal, 'create', async ([data], options) => {
    assert.equal(options.session, f.session);
    return [{ ...data, _id: goalId }];
  });
  const body = { planId, title: 'Tickets', level: 'individual', ownerEmployeeId: employeeId };
  const created = await service.createGoal(auth, body);
  assert.equal(created.teamId, teamId);
  assert.equal(created.progress, 0);
  assert.equal(created.createdBy, userId);
  await assert.rejects(service.createGoal(auth, { ...body, level: 'organization' }), { statusCode: 403 });
  await assert.rejects(service.createGoal(auth, { ...body, teamId: otherId }), { statusCode: 400 });
  f.employee._id = otherId;
  await assert.rejects(service.createGoal(auth, { ...body, ownerEmployeeId: employeeId }), { statusCode: 403 });
  f.employee._id = employeeId;
  f.user.role = 'hr';
  await assert.rejects(service.createGoal(auth, { ...body, level: 'team' }), { statusCode: 400 });
  f.employee.teamId = otherId;
  t.mock.method(Team, 'findOne', () => query({ _id: teamId, teamLeadEmployeeId: id(20) }));
  await assert.rejects(service.createGoal(auth, { ...body, level: 'team', teamId }), { statusCode: 400 });
  t.mock.method(User, 'exists', () => query(null));
  await assert.rejects(service.createGoal(auth, body), { statusCode: 400 });
  assert.equal(create.mock.callCount(), 1);
});

test('cascading enforces plan and team boundaries and immutable parent links', async (t) => {
  const f = fixture(t);
  t.mock.method(Goal, 'create', async ([data]) => [data]);
  const body = { planId, title: 'Personal', level: 'individual', ownerEmployeeId: employeeId, parentGoalId: goalId };
  f.goal.level = 'organization';
  await service.createGoal(auth, body);
  f.goal.level = 'team';
  await service.createGoal(auth, body);
  f.goal.teamId = otherId;
  await assert.rejects(service.createGoal(auth, body), { statusCode: 400 });
  f.goal.teamId = teamId;
  f.goal.level = 'individual';
  await assert.rejects(service.createGoal(auth, body), { statusCode: 400 });
  f.goal.level = 'organization';
  f.goal.planId = otherId;
  await assert.rejects(service.createGoal(auth, body), { statusCode: 400 });
  f.goal.planId = planId;
  f.goal.status = 'completed';
  await assert.rejects(service.createGoal(auth, body), { statusCode: 409 });
  await assert.rejects(service.updateGoal(auth, goalId, { parentGoalId: otherId }), { statusCode: 400 });
  await assert.rejects(service.updateGoal(auth, goalId, { ownerEmployeeId: otherId }), { statusCode: 400 });
});

test('key results support numeric and milestone targets and reject metric changes after progress', async (t) => {
  const f = fixture(t);
  t.mock.method(KeyResult, 'create', async ([data], options) => {
    assert.equal(options.session, f.session);
    return [data];
  });
  const result = await service.createKeyResult(auth, goalId, { title: 'Response hours', type: 'decrease', startValue: 48, targetValue: 24 });
  assert.equal(result.currentValue, 48);
  assert.equal(result.progress, 0);
  const milestone = await service.createKeyResult(auth, goalId, { title: 'Complete training', type: 'milestone' });
  assert.equal(milestone.targetValue, 1);
  await service.updateKeyResult(auth, keyId, { startValue: 10, targetValue: 110 });
  assert.equal(f.key.currentValue, 10);
  f.key.checkInCount = 1;
  await assert.rejects(service.updateKeyResult(auth, keyId, { targetValue: 200 }), { statusCode: 409 });
  await service.updateKeyResult(auth, keyId, { title: 'Resolved tickets' });
  assert.equal(f.key.title, 'Resolved tickets');
  await assert.rejects(service.updateKeyResult(auth, keyId, { currentValue: 100 }), { statusCode: 400 });
});

test('check-ins atomically save current value, author, previous value and ordered history', async (t) => {
  const f = fixture(t);
  f.plan.status = 'active';
  f.goal.status = 'active';
  const records = [];
  t.mock.method(GoalCheckIn, 'create', async ([data], options) => {
    assert.equal(options.session, f.session);
    records.push(data);
    return [data];
  });
  let result = await service.createCheckIn(auth, keyId, { value: 50, note: ' First update ' });
  assert.equal(result.keyResult.progress, 50);
  assert.equal(result.goalProgress, 50);
  assert.equal(records[0].previousValue, 0);
  assert.equal(records[0].sequence, 1);
  assert.equal(records[0].updatedBy, userId);
  assert.equal(records[0].note, 'First update');
  result = await service.createCheckIn(auth, keyId, { value: 25 });
  assert.equal(result.keyResult.progress, 25, 'Corrections may lower current progress');
  assert.equal(records[1].previousValue, 50);
  assert.equal(records[1].sequence, 2);
  assert.equal(f.key.checkInCount, 2);
  assert.equal(f.transaction.mock.callCount(), 2);
  assert.equal(f.lock.mock.callCount(), 2);
});

test('check-ins require an active plan and goal, and validate milestone values', async (t) => {
  const f = fixture(t);
  const create = t.mock.method(GoalCheckIn, 'create', async ([data]) => [data]);
  await assert.rejects(service.createCheckIn(auth, keyId, { value: 10 }), { statusCode: 409 });
  f.plan.status = 'active';
  await assert.rejects(service.createCheckIn(auth, keyId, { value: 10 }), { statusCode: 409 });
  f.goal.status = 'active';
  f.key.type = 'milestone'; f.key.targetValue = 1;
  await assert.rejects(service.createCheckIn(auth, keyId, { value: 0.5 }), { statusCode: 400 });
  await assert.rejects(service.createCheckIn(auth, keyId, { value: '1' }), { statusCode: 400 });
  await service.createCheckIn(auth, keyId, { value: 1 });
  assert.equal(create.mock.callCount(), 1);
  f.plan.status = 'closed';
  await assert.rejects(service.createCheckIn(auth, keyId, { value: 0 }), { statusCode: 409 });
  await assert.rejects(service.updateGoal(auth, goalId, { title: 'Changed' }), { statusCode: 409 });
  await assert.rejects(service.createKeyResult(auth, goalId, { title: 'Extra', type: 'milestone' }), { statusCode: 409 });
});

test('goal completion requires actual achievement; completed goals lock and managers can reopen', async (t) => {
  const f = fixture(t);
  await assert.rejects(service.updateGoal(auth, goalId, { status: 'active' }), { statusCode: 409 });
  f.plan.status = 'active';
  await service.updateGoal(auth, goalId, { status: 'active' });
  await assert.rejects(service.updateGoal(auth, goalId, { status: 'completed' }), { statusCode: 409 });
  f.key.currentValue = 99.9999;
  await assert.rejects(service.updateGoal(auth, goalId, { status: 'completed' }), { statusCode: 409 });
  f.key.currentValue = 100;
  await service.updateGoal(auth, goalId, { status: 'completed' });
  await assert.rejects(service.updateGoal(auth, goalId, { title: 'Changed' }), { statusCode: 409 });
  await assert.rejects(service.updateKeyResult(auth, keyId, { title: 'Changed' }), { statusCode: 409 });
  f.user.role = 'employee';
  await assert.rejects(service.updateGoal(auth, goalId, { status: 'active' }), { statusCode: 403 });
  f.user.role = 'hr';
  await service.updateGoal(auth, goalId, { status: 'active' });
  assert.equal(f.goal.status, 'active');
  t.mock.method(KeyResult, 'find', () => query([]));
  await assert.rejects(service.updateGoal(auth, goalId, { status: 'completed' }), { statusCode: 409 });
});

test('goal listing combines visibility with user filters and derives progress and overdue status', async (t) => {
  const f = fixture(t, 'employee');
  f.key.currentValue = 50;
  f.plan.endDate = new Date('2020-01-01');
  let filter;
  t.mock.method(Goal, 'find', (value) => { filter = value; return query([f.goal]); });
  t.mock.method(Goal, 'countDocuments', async () => 1);
  t.mock.method(GoalPlan, 'find', () => query([f.plan]));
  const result = await service.listGoals(auth, { planId, ownerEmployeeId: otherId });
  assert.equal(filter.organizationId, orgId);
  assert.equal(filter.ownerEmployeeId, otherId);
  assert.deepEqual(filter.$or[2], { level: 'individual', ownerEmployeeId: { $in: [employeeId] } });
  assert.equal(result.goals[0].progress, 50);
  assert.equal(result.goals[0].isOverdue, true);
  assert.equal(result.pagination.total, 1);
  assert.equal((await service.getGoal(auth, goalId)).keyResults[0].progress, 50);
  await assert.rejects(service.listGoals(auth, { status: 'deleted' }), { statusCode: 400 });
  await assert.rejects(service.listGoals(auth, { page: '-1' }), { statusCode: 400 });
  await service.children(auth, goalId);
  assert.equal(filter.parentGoalId, goalId);
});

test('check-in history is paginated and goes through goal visibility checks', async (t) => {
  fixture(t, 'employee');
  const record = { keyResultId: keyId, sequence: 1, value: 50 };
  t.mock.method(GoalCheckIn, 'find', (filter) => {
    assert.equal(filter.organizationId, orgId);
    assert.equal(filter.keyResultId, keyId);
    return query([record]);
  });
  t.mock.method(GoalCheckIn, 'countDocuments', async () => 1);
  assert.equal((await service.listCheckIns(auth, keyId)).checkIns[0].value, 50);
  t.mock.method(Goal, 'findOne', () => query(null));
  await assert.rejects(service.listCheckIns(auth, keyId), { statusCode: 404 });
  await assert.rejects(service.createCheckIn(auth, keyId, { value: 1 }), { statusCode: 404 });
});

test('Goals HTTP API authenticates every route and supports the full plan-to-check-in flow', async (t) => {
  const f = fixture(t);
  t.mock.method(GoalPlan, 'create', async (data) => ({ ...data, _id: planId, status: 'draft' }));
  t.mock.method(Goal, 'create', async ([data]) => [{ ...data, _id: goalId, status: 'draft' }]);
  t.mock.method(KeyResult, 'create', async ([data]) => [{ ...data, _id: keyId, checkInCount: 0 }]);
  t.mock.method(GoalCheckIn, 'create', async ([data]) => [{ ...data, _id: id(11) }]);
  t.mock.method(GoalPlan, 'find', () => query([f.plan]));
  t.mock.method(GoalPlan, 'countDocuments', async () => 1);
  t.mock.method(Goal, 'find', () => query([f.goal]));
  t.mock.method(Goal, 'countDocuments', async () => 1);
  t.mock.method(GoalCheckIn, 'find', () => query([]));
  t.mock.method(GoalCheckIn, 'countDocuments', async () => 0);
  const server = await new Promise((resolve) => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const token = jwt.sign(auth, process.env.JWT_SECRET);
  const request = (method, path, body, authenticated = true) => fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...(authenticated ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const routes = [
    ['GET', '/goal-plans'], ['POST', '/goal-plans'], ['GET', `/goal-plans/${planId}`], ['PATCH', `/goal-plans/${planId}`],
    ['GET', '/goals'], ['POST', '/goals'], ['GET', `/goals/${goalId}`], ['PATCH', `/goals/${goalId}`],
    ['GET', `/goals/${goalId}/children`], ['POST', `/goals/${goalId}/key-results`], ['PATCH', `/key-results/${keyId}`],
    ['POST', `/key-results/${keyId}/check-ins`], ['GET', `/key-results/${keyId}/check-ins`],
  ];
  for (const [method, path] of routes) assert.equal((await request(method, path, undefined, false)).status, 401, `${method} ${path}`);
  assert.equal((await request('POST', '/goal-plans', { name: 'Q1', startDate: '2027-01-01', endDate: '2027-03-31' })).status, 201);
  assert.equal((await request('PATCH', `/goal-plans/${planId}`, { status: 'active' })).status, 200);
  assert.equal((await request('POST', '/goals', { title: 'Support', planId, level: 'individual', ownerEmployeeId: employeeId })).status, 201);
  assert.equal((await request('POST', `/goals/${goalId}/key-results`, { title: 'Tickets', type: 'increase', startValue: 0, targetValue: 100 })).status, 201);
  assert.equal((await request('PATCH', `/goals/${goalId}`, { status: 'active' })).status, 200);
  const response = await request('POST', `/key-results/${keyId}/check-ins`, { value: 50, note: 'Halfway' });
  assert.equal(response.status, 201);
  const data = await response.json();
  assert.equal(data.success, true);
  assert.equal(data.keyResult.progress, 50);
  assert.equal(data.checkIn.updatedBy, userId);
  for (const [method, path] of routes.filter(([method]) => method === 'GET')) {
    assert.equal((await request(method, path)).status, 200, path);
  }
  assert.equal((await request('GET', '/goals/bad')).status, 400);
  assert.equal((await request('GET', '/unknown', undefined, false)).status, 404);
  f.user.role = 'employee';
  assert.equal((await request('POST', '/goal-plans', { name: 'Q1', startDate: '2027-01-01', endDate: '2027-03-31' })).status, 403);
});

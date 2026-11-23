const mongoose = require('mongoose');
const GoalPlan = require('../models/goalplan');
const Goal = require('../models/goal');
const KeyResult = require('../models/keyresult');
const GoalCheckIn = require('../models/goalcheckin');
const Employee = require('../../auth/models/employee');
const User = require('../../auth/models/usermodel');
const Team = require('../../organization/models/team');
const { belongsToCompany } = require('../../organization/services/hierarchyservice');
const access = require('./access');
const v = require('./validation');

const plain = (record) => record.toObject ? record.toObject() : { ...record };
const keyView = (record) => ({ ...plain(record), progress: v.progress(record) });
const pageInfo = (page, limit, total) => ({ page, limit, total, totalPages: Math.ceil(total / limit) });
const scoped = (ctx, extra = {}) => ({ organizationId: ctx.organizationId, ...extra });

async function findPlan(ctx, id, session) {
  v.objectId(id, 'planId');
  const plan = await GoalPlan.findOne(scoped(ctx, { _id: id })).session(session || null);
  if (!plan) v.fail('Goal plan was not found', 404);
  return plan;
}

async function findGoal(ctx, id, session) {
  v.objectId(id, 'goalId');
  const goal = await Goal.findOne({ ...scoped(ctx, { _id: id }), ...access.visibility(ctx) }).session(session || null);
  if (!goal) v.fail('Goal was not found', 404);
  return goal;
}

async function findKey(ctx, id, session) {
  v.objectId(id, 'keyResultId');
  const key = await KeyResult.findOne(scoped(ctx, { _id: id })).session(session || null);
  if (!key) v.fail('Key result was not found', 404);
  const goal = await findGoal(ctx, String(key.goalId), session);
  return { key, goal };
}

async function withPlanLock(ctx, id, operation) {
  v.objectId(id, 'planId');
  // Serializing writes per plan prevents check-ins racing with closure, goal
  // completion, or metric changes. Both the current value and history commit together.
  return mongoose.connection.transaction(async (session) => {
    const plan = await GoalPlan.findOneAndUpdate(scoped(ctx, { _id: id }),
      { $inc: { writeVersion: 1 } }, { new: true, session, timestamps: false });
    if (!plan) v.fail('Goal plan was not found', 404);
    return operation(plan, session);
  });
}

function editablePlan(plan) {
  if (!['draft', 'active'].includes(plan.status)) v.fail('Closed or archived plans cannot be changed', 409);
}

function editableGoal(goal) {
  if (['completed', 'cancelled'].includes(goal.status)) v.fail('Reopen this goal before changing it', 409);
}

function validDates(plan) {
  if (plan.endDate < plan.startDate) v.fail('endDate must be on or after startDate');
}

async function createPlan(authUser, body) {
  const data = v.planInput(body, true);
  validDates(data);
  const ctx = await access.context(authUser);
  access.requireAdmin(ctx);
  return GoalPlan.create({ ...data, organizationId: ctx.organizationId, createdBy: ctx.user._id });
}

async function listPlans(authUser, query = {}) {
  const { page, limit } = v.pagination(query);
  const ctx = await access.context(authUser);
  const filter = scoped(ctx);
  if (query.status !== undefined) filter.status = v.choice(query.status, 'status', ['draft', 'active', 'closed', 'archived']);
  const [plans, total] = await Promise.all([
    GoalPlan.find(filter).sort({ startDate: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    GoalPlan.countDocuments(filter),
  ]);
  return { plans, pagination: pageInfo(page, limit, total) };
}

async function getPlan(authUser, id) {
  const ctx = await access.context(authUser);
  return findPlan(ctx, id);
}

async function updatePlan(authUser, id, body) {
  const data = v.planInput(body);
  const ctx = await access.context(authUser);
  access.requireAdmin(ctx);
  return withPlanLock(ctx, id, async (plan, session) => {
    const next = data.status || plan.status;
    const transitions = { draft: ['draft', 'active'], active: ['active', 'closed'], closed: ['archived'], archived: [] };
    if (!transitions[plan.status].includes(next)) v.fail('Invalid goal plan status transition', 409);
    if (['closed', 'archived'].includes(plan.status) && Object.keys(data).some((key) => key !== 'status')) {
      v.fail('Closed or archived plans cannot be edited', 409);
    }
    if (plan.status !== 'draft' && ('startDate' in data || 'endDate' in data)) v.fail('Plan dates can only change while draft', 409);
    Object.assign(plan, data);
    validDates(plan);
    await plan.save({ session });
    return plan;
  });
}

async function validateOwner(ctx, data, session) {
  const employee = await Employee.findById(data.ownerEmployeeId).session(session);
  if (!employee || !belongsToCompany(employee, ctx.organizationId)) v.fail('Owner employee was not found in this organization', 404);
  if (!await User.exists({ employee: employee._id, status: 'active' }).session(session)) v.fail('Goal owner must have an active account');
  if (data.level === 'organization') {
    if (data.teamId) v.fail('Organization goals cannot have a teamId');
    data.teamId = null;
  } else if (data.level === 'team') {
    if (!data.teamId) v.fail('teamId is required for team goals');
    const team = await Team.findOne(scoped(ctx, { _id: data.teamId, status: 'active' })).session(session);
    if (!team) v.fail('Active team was not found', 404);
    if (!access.same(employee.teamId, team._id) && !access.same(team.teamLeadEmployeeId, employee._id)) {
      v.fail('The owner must belong to or lead the selected team');
    }
  } else {
    if (data.teamId && !access.same(data.teamId, employee.teamId)) v.fail('teamId must match the owner employee team');
    data.teamId = employee.teamId || null;
  }
}

async function validateParent(ctx, data, session) {
  if (!data.parentGoalId) return;
  const parent = await findGoal(ctx, data.parentGoalId, session);
  if (!access.same(parent.planId, data.planId)) v.fail('Parent and child goals must belong to the same plan');
  if (['completed', 'cancelled'].includes(parent.status)) v.fail('Cannot cascade from a completed or cancelled goal', 409);
  const valid = parent.level === 'organization' && ['team', 'individual'].includes(data.level)
    || parent.level === 'team' && data.level === 'individual' && access.same(parent.teamId, data.teamId);
  if (!valid) v.fail('Cascade from organization to team/individual, or team to an individual in that team');
  // Parent links and levels are immutable; strict level ordering prevents cycles.
}

async function createGoal(authUser, body) {
  const data = v.goalInput(body, true);
  const ctx = await access.context(authUser);
  return withPlanLock(ctx, data.planId, async (plan, session) => {
    editablePlan(plan);
    await validateOwner(ctx, data, session);
    access.requireManage(ctx, { ...data, organizationId: ctx.organizationId });
    await validateParent(ctx, data, session);
    const [goal] = await Goal.create([{ ...data, organizationId: ctx.organizationId, createdBy: ctx.user._id }], { session });
    return { ...plain(goal), progress: 0, keyResults: [] };
  });
}

function goalView(goal, results, plan) {
  return {
    ...plain(goal), progress: v.goalProgress(results), keyResults: results.map(keyView),
    isOverdue: !['completed', 'cancelled'].includes(goal.status) && Date.now() >= new Date(plan.endDate).getTime() + 86400000,
  };
}

async function getGoal(authUser, id) {
  const ctx = await access.context(authUser);
  const goal = await findGoal(ctx, id);
  const [plan, results] = await Promise.all([
    findPlan(ctx, String(goal.planId)),
    KeyResult.find(scoped(ctx, { goalId: goal._id })).sort({ createdAt: 1, _id: 1 }).lean(),
  ]);
  return goalView(goal, results, plan);
}

async function listGoals(authUser, query = {}) {
  const { page, limit } = v.pagination(query);
  const ctx = await access.context(authUser);
  const filter = { ...scoped(ctx), ...access.visibility(ctx) };
  for (const key of ['planId', 'ownerEmployeeId', 'teamId', 'parentGoalId']) {
    if (query[key] !== undefined) filter[key] = v.objectId(query[key], key);
  }
  if (query.level !== undefined) filter.level = v.choice(query.level, 'level', ['organization', 'team', 'individual']);
  if (query.status !== undefined) filter.status = v.choice(query.status, 'status', ['draft', 'active', 'completed', 'cancelled']);
  const [goals, total] = await Promise.all([
    Goal.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Goal.countDocuments(filter),
  ]);
  const ids = goals.map((goal) => goal._id);
  const [results, plans] = goals.length ? await Promise.all([
    KeyResult.find(scoped(ctx, { goalId: { $in: ids } })).sort({ createdAt: 1, _id: 1 }).lean(),
    GoalPlan.find(scoped(ctx, { _id: { $in: goals.map((goal) => goal.planId) } })).lean(),
  ]) : [[], []];
  return { goals: goals.map((goal) => goalView(goal, results.filter((key) => access.same(key.goalId, goal._id)),
    plans.find((plan) => access.same(plan._id, goal.planId)))), pagination: pageInfo(page, limit, total) };
}

async function children(authUser, id, query = {}) {
  const ctx = await access.context(authUser);
  await findGoal(ctx, id);
  return listGoals(authUser, { ...query, parentGoalId: id });
}

async function updateGoal(authUser, id, body) {
  const data = v.goalInput(body);
  const ctx = await access.context(authUser);
  const original = await findGoal(ctx, id);
  access.requireManage(ctx, original);
  return withPlanLock(ctx, String(original.planId), async (plan, session) => {
    editablePlan(plan);
    const goal = await findGoal(ctx, id, session);
    access.requireManage(ctx, goal);
    const next = data.status || goal.status;
    if (['completed', 'cancelled'].includes(goal.status)) {
      if (next !== 'active' || Object.keys(data).length !== 1) v.fail('Reopen the goal with status active before editing', 409);
      if (!ctx.admin && access.same(ctx.employee?._id, goal.ownerEmployeeId)) v.fail('Ask HR or your manager to reopen this goal', 403);
    } else {
      const transitions = { draft: ['draft', 'active', 'cancelled'], active: ['active', 'completed', 'cancelled'] };
      if (!transitions[goal.status].includes(next)) v.fail('Invalid goal status transition', 409);
    }
    if (next === 'active' && plan.status !== 'active') v.fail('Activate the goal plan first', 409);
    const results = await KeyResult.find(scoped(ctx, { goalId: goal._id })).session(session).lean();
    if (next === 'completed' && (!results.length || !results.every(v.achieved))) {
      v.fail('All key results must reach 100% before completing the goal', 409);
    }
    Object.assign(goal, data);
    await goal.save({ session });
    return goalView(goal, results, plan);
  });
}

async function createKeyResult(authUser, goalId, body) {
  const data = v.validateMetric(v.keyResultInput(body, true));
  const ctx = await access.context(authUser);
  const original = await findGoal(ctx, goalId);
  access.requireManage(ctx, original);
  return withPlanLock(ctx, String(original.planId), async (plan, session) => {
    editablePlan(plan);
    const goal = await findGoal(ctx, goalId, session);
    access.requireManage(ctx, goal);
    editableGoal(goal);
    const [key] = await KeyResult.create([{ ...data, organizationId: ctx.organizationId, planId: plan._id, goalId: goal._id,
      currentValue: data.startValue, createdBy: ctx.user._id }], { session });
    return keyView(key);
  });
}

async function updateKeyResult(authUser, id, body) {
  const data = v.keyResultInput(body);
  const ctx = await access.context(authUser);
  const original = await findKey(ctx, id);
  access.requireManage(ctx, original.goal);
  return withPlanLock(ctx, String(original.key.planId), async (plan, session) => {
    editablePlan(plan);
    const { key, goal } = await findKey(ctx, id, session);
    access.requireManage(ctx, goal);
    editableGoal(goal);
    const changingMetric = ['type', 'startValue', 'targetValue'].some((field) => Object.hasOwn(data, field));
    if (key.checkInCount > 0 && changingMetric) v.fail('Metric definitions cannot change after the first check-in', 409);
    const metric = v.validateMetric({ ...plain(key), ...data });
    Object.assign(key, data, { startValue: metric.startValue, targetValue: metric.targetValue });
    if (changingMetric) key.currentValue = metric.startValue;
    await key.save({ session });
    return keyView(key);
  });
}

async function createCheckIn(authUser, id, body) {
  const data = v.bodyFields(body, ['value', 'note'], ['value']);
  v.number(data.value, 'value');
  data.note = data.note === undefined ? '' : v.text(data.note, 'note', 2000, true);
  const ctx = await access.context(authUser);
  const original = await findKey(ctx, id);
  access.requireManage(ctx, original.goal);
  return withPlanLock(ctx, String(original.key.planId), async (plan, session) => {
    if (plan.status !== 'active') v.fail('Check-ins require an active goal plan', 409);
    const { key, goal } = await findKey(ctx, id, session);
    access.requireManage(ctx, goal);
    if (goal.status !== 'active') v.fail('Check-ins require an active goal', 409);
    if (key.type === 'milestone' && ![0, 1].includes(data.value)) v.fail('Milestone value must be 0 or 1');
    const [checkIn] = await GoalCheckIn.create([{ ...data, organizationId: ctx.organizationId, planId: plan._id,
      goalId: goal._id, keyResultId: key._id, previousValue: key.currentValue,
      sequence: key.checkInCount + 1, updatedBy: ctx.user._id }], { session });
    key.currentValue = data.value;
    key.checkInCount += 1;
    await key.save({ session });
    const results = await KeyResult.find(scoped(ctx, { goalId: goal._id })).session(session).lean();
    return { checkIn, keyResult: keyView(key), goalProgress: v.goalProgress(results) };
  });
}

async function listCheckIns(authUser, id, query = {}) {
  const { page, limit } = v.pagination(query);
  const ctx = await access.context(authUser);
  const { key } = await findKey(ctx, id);
  const filter = scoped(ctx, { keyResultId: key._id });
  const [checkIns, total] = await Promise.all([
    GoalCheckIn.find(filter).sort({ sequence: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    GoalCheckIn.countDocuments(filter),
  ]);
  return { checkIns, pagination: pageInfo(page, limit, total) };
}

module.exports = { createPlan, listPlans, getPlan, updatePlan, createGoal, listGoals, getGoal, children, updateGoal,
  createKeyResult, updateKeyResult, createCheckIn, listCheckIns };

const { test } = require('node:test');
const mongoose = require('mongoose');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
process.env.JWT_SECRET = 'criteria-test-secret';
const app = require('../src/app');
const Framework = require('../src/modules/performance-framework/models/performanceframework');
const Organization = require('../src/modules/organization/models/organization');
const criteria = require('../src/modules/performance-framework/services/criterionservice');
const frameworks = require('../src/modules/performance-framework/services/frameworkservice');
const competencies = require('../src/modules/performance-framework/services/competencyservice');
const kpis = require('../src/modules/performance-framework/services/kpiservice');
const { parseCriterion, scoringSummary, requireValidWeights } = require('../src/modules/performance-framework/services/criteriavalidation');
const org = '507f1f77bcf86cd799439011';
const id = '507f1f77bcf86cd799439012';
const itemId = '507f1f77bcf86cd799439013';
const competency = { _id: itemId, name: 'Problem Solving', category: 'technical', weight: 30, status: 'active' };
const kpi = { _id: '507f1f77bcf86cd799439014', name: 'Task Completion', measurementUnit: 'percentage', targetValue: 90, weight: 50, status: 'active' };

function setup(t, status = 'draft') {
  const state = { _id: id, organizationId: org, name: 'Engineering', status, __v: 0, competencies: [], kpis: [] };
  t.mock.method(Organization, 'findOne', async () => ({ _id: org }));
  const copy = (value) => JSON.parse(JSON.stringify(value));
  t.mock.method(Framework, 'findOne', () => ({ lean: async () => copy(state) }));
  t.mock.method(Framework, 'findOneAndUpdate', (filter, update) => {
    const save = async () => {
      assert.equal(filter.organizationId, org);
      if (filter.__v !== state.__v) return null;
      Object.assign(state, update.$set);
      state.__v++;
      return copy(state);
    };
    return { lean: save, populate: save };
  });
  return state;
}

test('criterion validation handles numeric values, status and required fields', () => {
  assert.equal(parseCriterion({ name: ' KPI ', measurementUnit: 'count', targetValue: 0, weight: 0 }, 'kpis', true).targetValue, 0);
  for (const body of [{ name: '' }, { weight: '30' }, { weight: -1 }, { weight: 101 }, { targetValue: Infinity }, { status: 'draft' }, { _id: itemId }, { targetPeriod: null }]) {
    assert.throws(() => parseCriterion(body, 'kpis'), { statusCode: 400 });
  }
  assert.throws(() => parseCriterion({ name: 'Skill', weight: 30 }, 'competencies', true), { statusCode: 400 });
  assert.throws(() => parseCriterion({ category: 'other' }, 'competencies'), { statusCode: 400 });
  assert.throws(() => parseCriterion({ name: 'KPI', weight: 50 }, 'kpis', true), { statusCode: 400 });
});

test('combined scoring includes only active criteria and accepts fractional weights', () => {
  const framework = { competencies: [competency, { ...competency, weight: 20 }], kpis: [kpi] };
  assert.deepEqual(scoringSummary(framework), { competencyCount: 2, kpiCount: 1, totalWeight: 100, weightsValid: true });
  requireValidWeights(framework);
  framework.kpis[0] = { ...kpi, status: 'inactive' };
  assert.equal(scoringSummary(framework).totalWeight, 50);
  assert.throws(() => requireValidWeights(framework), { statusCode: 400 });
  assert.throws(() => requireValidWeights({}), { statusCode: 400 });
  requireValidWeights({ competencies: [{ weight: 33.33 }, { weight: 33.33 }], kpis: [{ weight: 33.34 }] });
});

test('competency and KPI create, edit, deactivate and search preserve embedded IDs', async (t) => {
  const state = setup(t);
  const created = await competencies.create(id, { name: 'Problem Solving', category: 'technical', weight: 30 });
  assert.ok(created.criterion._id);
  const selectedId = String(created.criterion._id);
  await competencies.update(id, selectedId, { description: 'Solve technical issues', status: 'inactive' });
  assert.equal(String(state.competencies[0]._id), selectedId);
  assert.equal(state.competencies[0].status, 'inactive');
  const result = await kpis.create(id, { name: 'Task Completion', measurementUnit: 'percentage', targetValue: 90, weight: 50, targetPeriod: 'Quarter 1' });
  await kpis.update(id, String(result.criterion._id), { targetValue: 95 });
  assert.equal(state.kpis[0].targetValue, 95);
  const list = await competencies.list(id, { search: 'technical', status: 'inactive' });
  assert.equal(list.competencies.length, 1);
  assert.equal(list.scoring.competencyCount, 0);
  await assert.rejects(competencies.update(id, itemId, { name: 'Missing' }), { statusCode: 404 });
  await assert.rejects(kpis.update(id, 'bad', { weight: 30 }), { statusCode: 400 });
});

test('activation requires 100%, and active edits cannot break scoring totals', async (t) => {
  const state = setup(t);
  await assert.rejects(frameworks.updateFramework(id, { status: 'active' }), { statusCode: 400 });
  await assert.rejects(frameworks.createFramework({ name: 'Empty', status: 'active' }, itemId), { statusCode: 400 });
  state.competencies = [competency, { ...competency, _id: new mongoose.Types.ObjectId(), name: 'Communication', weight: 20 }];
  state.kpis = [kpi];
  const active = await frameworks.updateFramework(id, { status: 'active' });
  assert.equal(active.totalWeight, 100);
  assert.equal(active.competencyCount, 2);
  assert.equal(active.kpiCount, 1);
  await assert.rejects(competencies.update(id, itemId, { status: 'inactive' }), { statusCode: 400 });
  await assert.rejects(kpis.update(id, String(kpi._id), { weight: 40 }), { statusCode: 400 });
  await competencies.update(id, itemId, { name: 'Problem Solving Updated' });
  await frameworks.updateFramework(id, { status: 'draft' });
  await competencies.update(id, itemId, { status: 'inactive' });
  await frameworks.updateFramework(id, { status: 'archived' });
  await assert.rejects(kpis.update(id, String(kpi._id), { name: 'Updated' }), { statusCode: 409 });
});

test('concurrent criterion edits reject stale versions instead of overwriting data', async (t) => {
  const state = setup(t);
  const results = await Promise.allSettled([
    competencies.create(id, { name: 'Skill A', category: 'technical', weight: 20 }),
    competencies.create(id, { name: 'Skill B', category: 'behavioral', weight: 30 }),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.find((result) => result.status === 'rejected').reason.statusCode, 409);
  assert.equal(state.competencies.length, 1);
});

test('criterion reads scope framework to company and handle legacy/missing arrays', async (t) => {
  t.mock.method(Organization, 'findOne', async () => ({ _id: org }));
  const lookup = t.mock.method(Framework, 'findOne', (filter) => {
    assert.deepEqual(filter, { _id: id, organizationId: org });
    return { lean: async () => ({ _id: id }) };
  });
  assert.deepEqual((await criteria.listCriteria(id, 'kpis', {})).kpis, []);
  lookup.mock.mockImplementation(() => ({ lean: async () => null }));
  await assert.rejects(competencies.list(id, {}), { statusCode: 404 });
});

test('criteria endpoints enforce access and return correct list/create/edit responses', async (t) => {
  const state = setup(t);
  state.competencies = [competency];
  state.kpis = [kpi];
  const server = await new Promise((resolve) => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const send = (method, path, role, body) => fetch(`http://127.0.0.1:${server.address().port}${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...(role && { Authorization: `Bearer ${jwt.sign({ role }, process.env.JWT_SECRET)}` }) },
    ...(body && { body: JSON.stringify(body) }),
  });
  for (const [kind, singular, body, criterionId] of [
    ['competencies', 'competency', { name: 'Communication', category: 'behavioral', weight: 20 }, itemId],
    ['kpis', 'kpi', { name: 'Defects', measurementUnit: 'count', targetValue: 5, weight: 10 }, String(kpi._id)],
  ]) {
    for (const [method, suffix] of [['GET', ''], ['POST', ''], ['PATCH', `/${criterionId}`]]) {
      const path = `/api/performance-frameworks/${id}/${kind}${suffix}`;
      assert.equal((await send(method, path, null)).status, 401);
      assert.equal((await send(method, path, 'employee')).status, 403);
      const response = await send(method, path, 'hr', method === 'POST' ? body : method === 'PATCH' ? { description: 'Updated' } : undefined);
      assert.equal(response.status, method === 'POST' ? 201 : 200);
      assert.ok(Object.hasOwn(await response.json(), method === 'GET' ? kind : singular));
    }
  }
  assert.equal((await send('PATCH', `/api/performance-frameworks/${id}/competencies/${itemId}`, 'admin', { status: 'inactive' })).status, 200);
});

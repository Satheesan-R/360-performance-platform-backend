const { test } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
process.env.JWT_SECRET = 'scoring-test-secret';
const app = require('../src/app');
const Framework = require('../src/modules/performance-framework/models/performanceframework');
const Snapshot = require('../src/modules/performance-framework/models/frameworksnapshot');
const Organization = require('../src/modules/organization/models/organization');
const { parseScoring, requireScoringReady, scoringStatus } = require('../src/modules/performance-framework/services/scoringvalidation');
const { preview } = require('../src/modules/performance-framework/services/scoringpreview');
const scoring = require('../src/modules/performance-framework/services/scoringservice');
const snapshots = require('../src/modules/performance-framework/services/snapshotservice');
const frameworks = require('../src/modules/performance-framework/services/frameworkservice');
const defaults = require('./fixtures/scoring.json');
const org = '507f1f77bcf86cd799439011';
const id = '507f1f77bcf86cd799439012';
const user = '507f1f77bcf86cd799439013';
const technical = '507f1f77bcf86cd799439014';
const behavioral = '507f1f77bcf86cd799439015';
const kpi = '507f1f77bcf86cd799439016';
const copy = (value) => JSON.parse(JSON.stringify(value));
function framework() {
  return { _id: id, organizationId: org, createdBy: user, __v: 0, status: 'draft', name: 'Engineering', ...copy(defaults),
    competencies: [{ _id: technical, name: 'Technical', category: 'technical', weight: 30, status: 'active' },
      { _id: behavioral, name: 'Communication', category: 'behavioral', weight: 20, status: 'active' }],
    kpis: [{ _id: kpi, name: 'Tasks', weight: 50, measurementUnit: 'percentage', targetValue: 90, status: 'active' }] };
}
function setup(t, state = framework()) {
  t.mock.method(Organization, 'findOne', async () => ({ _id: org }));
  t.mock.method(Framework, 'findOne', (filter) => { assert.equal(filter.organizationId, org); return { lean: async () => copy(state) }; });
  const update = t.mock.method(Framework, 'findOneAndUpdate', (filter, data) => {
    const save = async () => {
      assert.equal(filter.organizationId, org);
      if (filter.__v !== state.__v) return null;
      Object.assign(state, copy(data.$set)); state.__v++;
      return copy(state);
    };
    return { lean: save, populate: save };
  });
  return { state, update };
}

test('rating scales validate exact levels and custom labels for 1–3, 1–4 and 1–5', () => {
  for (const max of [3, 4, 5]) {
    const ratingScale = { min: 1, max, levels: Array.from({ length: max }, (_, index) => ({ value: index + 1, label: `Custom ${index + 1}` })).reverse() };
    assert.equal(parseScoring({ ratingScale }).ratingScale.levels[0].value, 1);
  }
  for (const ratingScale of [null, { min: 0, max: 5, levels: [] }, { min: 1, max: 6, levels: [] },
    { min: 1, max: 3, levels: [{ value: 1, label: 'A' }, { value: 1, label: 'B' }, { value: 3, label: 'C' }] },
    { min: 1, max: 3, levels: [{ value: 1, label: '' }, { value: 2, label: 'B' }, { value: 3, label: 'C' }] }]) {
    assert.throws(() => parseScoring({ ratingScale }), { statusCode: 400 });
  }
  assert.throws(() => parseScoring({ categoryWeights: { technical: '60', behavioral: 40 } }), { statusCode: 400 });
  assert.throws(() => parseScoring({ reviewerWeights: { self: 20, peer: 0, manager: 60 } }), { statusCode: 400 });
  assert.throws(() => parseScoring({ enabledReviewers: ['self', 'self'] }), { statusCode: 400 });
  assert.throws(() => parseScoring({ organizationId: org }), { statusCode: 400 });
});

test('disabled peer reviewer requires explicit zero weight and a valid redistribution', () => {
  const data = framework();
  data.enabledReviewers = ['self', 'manager'];
  assert.throws(() => requireScoringReady(data), { statusCode: 400 });
  data.reviewerWeights = { self: 20, peer: 0, manager: 80 };
  requireScoringReady(data);
  data.reviewerWeights = { self: 0, peer: 0, manager: 100 };
  assert.throws(() => requireScoringReady(data), { statusCode: 400 });
  data.enabledReviewers = ['manager'];
  requireScoringReady(data);
  data.competencies[1].status = 'inactive';
  assert.equal(scoringStatus(data).ready, false);
});

test('preview combines category, KPI and reviewer weights without double-counting', () => {
  const data = framework();
  const ratings = Object.fromEntries(data.enabledReviewers.map((role) => [role, { [technical]: 4, [behavioral]: 3, [kpi]: 5 }]));
  const result = preview(data, ratings);
  assert.deepEqual(result.criteria.map((item) => item.effectiveWeight), [30, 20, 50]);
  assert.equal(result.totalEffectiveWeight, 100);
  assert.ok(Math.abs(result.sample.score - 4.3) < 1e-10);
  assert.ok(Math.abs(result.sample.normalizedPercent - 82.5) < 1e-10);
  data.categoryWeights = { technical: 80, behavioral: 20 };
  assert.deepEqual(preview(data).criteria.map((item) => item.effectiveWeight), [40, 10, 50]);
  assert.throws(() => preview(data, { self: {} }), { statusCode: 400 });
  ratings.self[technical] = 6;
  assert.throws(() => preview(data, ratings), { statusCode: 400 });
  assert.throws(() => preview(data, { outsider: {} }), { statusCode: 400 });
});

test('scoring saves increment the shared version and previews never write', async (t) => {
  const { state, update } = setup(t);
  const result = await scoring.updateScoring(id, { enabledReviewers: ['self', 'manager'], reviewerWeights: { self: 20, peer: 0, manager: 80 } });
  assert.equal(result.version, 1);
  assert.equal(result.validation.ready, true);
  const proposed = await scoring.previewScoring(id, { configuration: { categoryWeights: { technical: 80, behavioral: 20 } } });
  assert.equal(proposed.criteria[0].effectiveWeight, 40);
  assert.equal(state.categoryWeights.technical, 60);
  assert.equal(update.mock.callCount(), 1);
  update.mock.mockImplementation(() => ({ lean: async () => null }));
  await assert.rejects(scoring.updateScoring(id, { categoryWeights: { technical: 50, behavioral: 50 } }), { statusCode: 409 });
});

test('activation requires full scoring and archived settings cannot be changed', async (t) => {
  const { state } = setup(t);
  state.ratingScale = null;
  await assert.rejects(frameworks.updateFramework(id, { status: 'active' }), { statusCode: 400 });
  state.ratingScale = copy(defaults.ratingScale);
  assert.equal((await frameworks.updateFramework(id, { status: 'active' })).scoringValidation.ready, true);
  await assert.rejects(scoring.updateScoring(id, { enabledReviewers: ['self', 'manager'] }), { statusCode: 400 });
  state.status = 'archived';
  await assert.rejects(scoring.updateScoring(id, { categoryWeights: { technical: 50, behavioral: 50 } }), { statusCode: 409 });
});

test('snapshot data is detached, versioned, scoped and preserved after live edits', async (t) => {
  const data = framework(); data.status = 'active';
  const { state } = setup(t, data);
  let saved;
  t.mock.method(Snapshot, 'findOne', (filter) => ({ lean: async () => {
    assert.equal(filter.organizationId, org); assert.equal(filter.frameworkId, id);
    return saved && (filter.sourceVersion === saved.sourceVersion || String(filter._id) === user) ? copy(saved) : null;
  } }));
  const create = t.mock.method(Snapshot, 'create', async (value) => { saved = { ...copy(value), _id: user }; return saved; });
  const first = await snapshots.createSnapshot(id, user);
  state.ratingScale.levels[0].label = 'Changed'; state.kpis[0].targetValue = 99;
  assert.equal(first.configuration.ratingScale.levels[0].label, 'Needs Improvement');
  assert.equal(first.configuration.kpis[0].targetValue, 90);
  state.categoryWeights = { technical: 80, behavioral: 20 };
  assert.equal(preview(first.configuration).criteria[0].effectiveWeight, 30);
  assert.equal(preview(state).criteria[0].effectiveWeight, 40);
  await snapshots.createSnapshot(id, user);
  assert.equal(create.mock.callCount(), 1);
  assert.equal((await snapshots.getSnapshot(id, user)).sourceVersion, 0);
  state.__v++;
  const second = await snapshots.createSnapshot(id, user);
  assert.equal(second.sourceVersion, 1);
  assert.equal(second.configuration.kpis[0].targetValue, 99);
  await assert.rejects(snapshots.createSnapshot(id, user, { configuration: {} }), { statusCode: 400 });
  state.status = 'draft';
  await assert.rejects(snapshots.createSnapshot(id, user), { statusCode: 409 });
});

test('scoring schemas validate embedded rules and snapshot configuration is immutable', async () => {
  const document = new Framework(framework());
  await document.validate();
  assert.equal(document.ratingScale.levels[0]._id, undefined);
  document.reviewerWeights.self = -1;
  await assert.rejects(document.validate());
  assert.equal(Snapshot.schema.path('configuration').options.immutable, true);
});

test('scoring and snapshot endpoints require HR/admin and expose their response envelopes', async (t) => {
  t.mock.method(scoring, 'getScoring', async () => ({ ratingScale: null }));
  t.mock.method(scoring, 'updateScoring', async () => ({ version: 1 }));
  t.mock.method(scoring, 'previewScoring', async () => ({ totalEffectiveWeight: 100 }));
  t.mock.method(snapshots, 'createSnapshot', async (frameworkId, createdBy) => { assert.equal(createdBy, user); return { _id: org }; });
  t.mock.method(snapshots, 'getSnapshot', async () => ({ _id: org }));
  const server = await new Promise((resolve) => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  for (const [method, suffix, key, status] of [['GET', 'scoring', 'scoring', 200], ['PATCH', 'scoring', 'scoring', 200], ['POST', 'scoring/preview', 'preview', 200], ['POST', 'snapshots', 'snapshot', 201], ['GET', `snapshots/${org}`, 'snapshot', 200]]) {
    for (const role of [null, 'employee', 'hr', 'admin']) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/performance-frameworks/${id}/${suffix}`, { method, headers: role ? { Authorization: `Bearer ${jwt.sign({ id: user, role }, process.env.JWT_SECRET)}` } : {} });
      assert.equal(response.status, !role ? 401 : role === 'employee' ? 403 : status);
      if (['hr', 'admin'].includes(role)) assert.ok(Object.hasOwn(await response.json(), key));
    }
  }
});

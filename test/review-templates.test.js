const { test } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
process.env.JWT_SECRET = 'review-templates-test-secret';
const app = require('../src/app');
const Template = require('../src/modules/review-templates/models/reviewtemplate');
const Snapshot = require('../src/modules/review-templates/models/templatesnapshot');
const Framework = require('../src/modules/performance-framework/models/performanceframework');
const Organization = require('../src/modules/organization/models/organization');
const EmploymentType = require('../src/modules/organization/models/employmenttype');
const User = require('../src/modules/auth/models/usermodel');
const service = require('../src/modules/review-templates/services/templateservice');
const { previewTemplate } = require('../src/modules/review-templates/services/templatepreview');
const snapshots = require('../src/modules/review-templates/services/templatesnapshotservice');
const { parseTemplate, validateEmbeddedIds } = require('../src/modules/review-templates/services/templatevalidation');
const { requireTemplateReady } = require('../src/modules/review-templates/services/templaterelations');
const scoring = require('./fixtures/scoring.json');
const org = '507f1f77bcf86cd799439011';
const fw = '507f1f77bcf86cd799439012';
const user = '507f1f77bcf86cd799439013';
const technical = '507f1f77bcf86cd799439014';
const behavioral = '507f1f77bcf86cd799439015';
const kpi = '507f1f77bcf86cd799439016';
const type = '507f1f77bcf86cd799439017';
const id = '507f1f77bcf86cd799439018';
const copy = (value) => JSON.parse(JSON.stringify(value));

function framework() {
  return { _id: fw, organizationId: org, __v: 2, status: 'active', name: 'Engineering', ...copy(scoring), applicableEmploymentTypeIds: [type],
    competencies: [{ _id: technical, name: 'Technical Skills', category: 'technical', weight: 30, status: 'active' },
      { _id: behavioral, name: 'Communication', category: 'behavioral', weight: 20, status: 'active' }],
    kpis: [{ _id: kpi, name: 'Task Completion', measurementUnit: 'percentage', targetValue: 90, weight: 50, status: 'active' }] };
}
function body() {
  return { name: 'Annual Review', description: 'Annual evaluation', frameworkId: fw, employmentTypeIds: [type], evidenceRequired: false,
    sections: [{ title: 'Evaluation', competencyIds: [technical, behavioral], kpiIds: [kpi], required: true, evidenceRequired: true },
      { title: 'Comments', questions: [{ prompt: 'What were your main achievements?', required: true }], commentsRequired: true }] };
}
function setup(t) {
  const state = { template: null, framework: framework(), snapshots: [] };
  t.mock.method(Organization, 'findOne', async () => ({ _id: org }));
  t.mock.method(User, 'exists', async (filter) => { assert.equal(filter.status, 'active'); return true; });
  t.mock.method(EmploymentType, 'countDocuments', async (filter) => { assert.equal(filter.organizationId, org); assert.equal(filter.isActive, true); return filter._id.$in.includes(type) ? 1 : 0; });
  t.mock.method(Framework, 'findOne', (filter) => {
    assert.equal(String(filter._id), fw); assert.equal(String(filter.organizationId), org);
    return { lean: async () => state.framework ? copy(state.framework) : null };
  });
  t.mock.method(Template, 'create', async (data) => {
    const doc = new Template({ ...data, _id: id, __v: 0 }); await doc.validate();
    state.template = copy(doc.toObject()); return copy(state.template);
  });
  t.mock.method(Template, 'findOne', (filter) => {
    assert.equal(String(filter._id), id); assert.equal(String(filter.organizationId), org);
    return { lean: async () => state.template ? copy(state.template) : null };
  });
  t.mock.method(Template, 'findOneAndUpdate', (filter, update) => ({ lean: async () => {
    assert.equal(String(filter.organizationId), org);
    if (filter.__v !== state.template.__v) return null;
    const next = new Template({ ...state.template, ...update.$set, __v: state.template.__v + 1 }); await next.validate();
    // Model validation yields; emulate MongoDB's atomic version check at write time.
    if (filter.__v !== state.template.__v) return null;
    state.template = copy(next.toObject()); return copy(state.template);
  } }));
  t.mock.method(Snapshot, 'findOne', (filter) => ({ lean: async () => {
    assert.equal(String(filter.organizationId), org);
    return copy(state.snapshots.find((item) => filter._id ? item._id === filter._id && item.templateId === filter.templateId : item.sourceVersion === filter.sourceVersion) || null);
  } }));
  t.mock.method(Snapshot, 'create', async (data) => {
    const value = copy(new Snapshot(data).toObject()); state.snapshots.push(value); return copy(value);
  });
  return state;
}

test('template forms reject malformed nested fields, duplicates and evidence conflicts', () => {
  for (const value of [null, [], {}, { name: '' }, { createdBy: user }, { frameworkSnapshot: {} }, { status: 'inactive' },
    { sections: [{ title: 'A', allowComments: false, commentsRequired: true }] },
    { sections: [{ title: 'A', questions: [{ prompt: '', required: true }] }] },
    { sections: [{ title: 'A', competencyIds: [technical] }, { title: 'B', competencyIds: [technical] }] },
    { evidenceRequired: 'true' }, { employmentTypeIds: ['bad'] }]) {
    assert.throws(() => parseTemplate(value), { statusCode: 400 });
  }
  const parsed = parseTemplate(body(), true);
  assert.equal(parsed.sections[0].allowComments, true);
  assert.equal(parsed.sections[1].questions[0].required, true);
  assert.throws(() => validateEmbeddedIds([{ _id: id }]), { statusCode: 400 });
  assert.throws(() => validateEmbeddedIds([{ title: 'New', questions: [{ _id: id }] }]), { statusCode: 400 });
});

test('template creation validates framework, classifications and criteria and creates stable embedded IDs', async (t) => {
  const state = setup(t);
  const result = await service.createTemplate(body(), user);
  assert.equal(result.createdBy, user); assert.equal(result.organizationId, org);
  assert.equal(result.status, 'draft'); assert.equal(result.frameworkSnapshot, null);
  assert.ok(result.sections[0]._id); assert.ok(result.sections[1].questions[0]._id);
  await assert.rejects(service.createTemplate({ ...body(), employmentTypeIds: [id] }, user), { statusCode: 400 });
  state.framework.competencies[0].status = 'inactive';
  await assert.rejects(service.createTemplate(body(), user), { statusCode: 400 });
  state.framework = null;
  await assert.rejects(service.createTemplate(body(), user), { statusCode: 404 });
});

test('activation requires scoring coverage and pins the exact framework version', async (t) => {
  const state = setup(t);
  await service.createTemplate(body(), user);
  state.template.sections[0].kpiIds = [];
  await assert.rejects(service.updateTemplate(id, { status: 'active' }), { statusCode: 400 });
  state.template.sections[0].kpiIds = [kpi];
  const active = await service.updateTemplate(id, { status: 'active' });
  assert.equal(active.frameworkVersion, 2);
  state.framework.competencies[0].name = 'Live changed'; state.framework.ratingScale.levels[0].label = 'Changed'; state.framework.status = 'archived';
  const preview = await previewTemplate(id);
  assert.equal(preview.usesFrozenFramework, true); assert.equal(preview.validation.ready, true);
  assert.equal(preview.sections[0].competencies[0].name, 'Technical Skills');
  assert.equal(preview.ratingScale.levels[0].label, 'Needs Improvement');
  await service.updateTemplate(id, { description: 'Edited question text next' });
  assert.equal(state.template.frameworkVersion, 2);
  await assert.rejects(service.updateTemplate(id, { frameworkId: id }), { statusCode: 409 });
});

test('draft previews resolve criteria, questions, comments and inherited evidence without writes', async (t) => {
  const state = setup(t);
  await service.createTemplate(body(), user);
  const originalVersion = state.template.__v;
  const originalName = state.template.name;
  const preview = await previewTemplate(id, { name: 'Proposed', evidenceRequired: true });
  assert.equal(preview.name, 'Proposed'); assert.equal(preview.sections[1].evidenceRequired, true);
  assert.equal(preview.sections[1].commentsRequired, true);
  assert.equal(preview.sections[0].kpis[0].targetValue, 90);
  assert.equal(state.template.name, originalName); assert.equal(state.template.__v, originalVersion);
  state.framework.status = 'draft';
  assert.equal((await previewTemplate(id)).validation.ready, false);
  state.framework.competencies = [];
  const broken = await previewTemplate(id);
  assert.equal(broken.sections[0].competencies[0].missing, true);
});

test('template edits retain question IDs and concurrent saves reject stale versions', async (t) => {
  const state = setup(t);
  await service.createTemplate(body(), user);
  const sections = copy(state.template.sections);
  const questionId = sections[1].questions[0]._id;
  sections[1].questions[0].prompt = 'Describe your achievements';
  await service.updateTemplate(id, { sections });
  assert.equal(state.template.sections[1].questions[0]._id, questionId);
  const results = await Promise.allSettled([service.updateTemplate(id, { name: 'First' }), service.updateTemplate(id, { name: 'Second' })]);
  assert.equal(results.filter((item) => item.status === 'fulfilled').length, 1);
  assert.equal(results.find((item) => item.status === 'rejected').reason.statusCode, 409);
  await service.updateTemplate(id, { status: 'archived' });
  await assert.rejects(service.updateTemplate(id, { sections }), { statusCode: 409 });
  await service.updateTemplate(id, { status: 'draft', sections });
  assert.equal(state.template.frameworkSnapshot, null);
});

test('preview readiness validates proposed and inherited targeting without changing frozen templates', async (t) => {
  const state = setup(t);
  await service.createTemplate(body(), user);
  const originalVersion = state.template.__v;
  const proposed = await previewTemplate(id, { employmentTypeIds: [id] });
  assert.equal(proposed.validation.ready, false);
  assert.match(proposed.validation.message, /framework targeting/);
  assert.deepEqual(state.template.employmentTypeIds, [type]);
  assert.equal(state.template.__v, originalVersion);
  await service.updateTemplate(id, { status: 'active' });
  t.mock.method(EmploymentType, 'countDocuments', async () => 0);
  const savedActive = await previewTemplate(id);
  assert.equal(savedActive.validation.ready, true);
  const changedActive = await previewTemplate(id, { employmentTypeIds: [type] });
  assert.equal(changedActive.validation.ready, false);
  assert.match(changedActive.validation.message, /Employment types must exist/);
  // Empty selections inherit the framework's classifications, which also need validation.
  await service.updateTemplate(id, { status: 'draft' });
  const inherited = await previewTemplate(id, { employmentTypeIds: [] });
  assert.equal(inherited.validation.ready, false);
  assert.deepEqual(inherited.effectiveEmploymentTypeIds, [type]);
});

test('template snapshots preserve old questions and pinned scoring after template edits', async (t) => {
  const state = setup(t);
  await service.createTemplate({ ...body(), status: 'active' }, user);
  const first = await snapshots.createSnapshot(id, user);
  await snapshots.createSnapshot(id, user);
  assert.equal(state.snapshots.length, 1);
  const sections = copy(state.template.sections);
  sections[1].questions[0].prompt = 'A new question';
  await service.updateTemplate(id, { sections });
  const second = await snapshots.createSnapshot(id, user);
  assert.notEqual(first.sourceVersion, second.sourceVersion);
  const historical = await snapshots.getSnapshot(id, first._id);
  assert.equal(historical.configuration.sections[1].questions[0].prompt, 'What were your main achievements?');
  assert.equal(historical.configuration.framework.scoringFormulaVersion, 1);
  await assert.rejects(snapshots.createSnapshot(id, user, { sections: [] }), { statusCode: 400 });
});

test('template lists support status, framework, targeting, search and pagination', async (t) => {
  setup(t);
  let filter;
  const chain = { select(value) { assert.equal(value, '-frameworkSnapshot'); return this; }, sort() { return this; }, skip(value) { assert.equal(value, 10); return this; }, limit() { return this; }, populate() { return this; }, lean: async () => [] };
  t.mock.method(Template, 'find', (value) => { filter = value; return chain; });
  t.mock.method(Template, 'countDocuments', async () => 12);
  const result = await service.listTemplates({ page: '2', limit: '10', search: 'a.*', status: 'draft', frameworkId: fw, employmentTypeId: type });
  assert.equal(filter.organizationId, org); assert.equal(filter.frameworkId, fw); assert.equal(filter.employmentTypeIds, type);
  assert.equal(filter.$or[0].name.$regex, 'a\\.\\*');
  assert.deepEqual(result.pagination, { page: 2, limit: 10, total: 12, totalPages: 2 });
  await assert.rejects(service.listTemplates({ status: 'deleted' }), { statusCode: 400 });
});

test('template activation rejects empty sections and incomplete frameworks', () => {
  assert.throws(() => requireTemplateReady({ sections: [] }, framework()), { statusCode: 400 });
  assert.throws(() => requireTemplateReady(body(), { ...framework(), status: 'draft' }), { statusCode: 400 });
  assert.throws(() => requireTemplateReady({ ...body(), sections: [{ title: 'Empty', allowComments: false }] }, framework()), { statusCode: 400 });
});

test('Review Templates HTTP APIs enforce access and serve CRUD, previews and snapshots', async (t) => {
  setup(t);
  const created = await service.createTemplate({ ...body(), status: 'active' }, user);
  const snap = await snapshots.createSnapshot(id, user);
  t.mock.method(Template, 'find', () => ({ select() { return this; }, sort() { return this; }, skip() { return this; }, limit() { return this; }, populate() { return this; }, lean: async () => [created] }));
  t.mock.method(Template, 'countDocuments', async () => 1);
  const server = await new Promise((resolve) => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const send = (method, path, role, data) => fetch(`http://127.0.0.1:${server.address().port}${path}`, { method,
    headers: { 'Content-Type': 'application/json', ...(role && { Authorization: `Bearer ${jwt.sign({ id: user, role }, process.env.JWT_SECRET)}` }) },
    ...(data && { body: JSON.stringify(data) }),
  });
  for (const [method, path, key, status, data] of [
    ['GET', '/api/review-templates', 'templates', 200], ['GET', `/api/review-templates/${id}`, 'template', 200],
    ['PATCH', `/api/review-templates/${id}`, 'template', 200, { description: 'Edited' }],
    ['GET', `/api/review-templates/${id}/preview`, 'preview', 200], ['POST', `/api/review-templates/${id}/preview`, 'preview', 200, {}],
    ['POST', `/api/review-templates/${id}/snapshots`, 'snapshot', 201, {}],
    ['GET', `/api/review-templates/${id}/snapshots/${snap._id}`, 'snapshot', 200],
    ['POST', '/api/review-templates', 'template', 201, body()],
  ]) {
    assert.equal((await send(method, path, null, data)).status, 401);
    assert.equal((await send(method, path, 'employee', data)).status, 403);
    const response = await send(method, path, 'hr', data);
    assert.equal(response.status, status, `${method} ${path}`);
    assert.ok(Object.hasOwn(await response.json(), key));
  }
  assert.equal((await send('PATCH', `/api/review-templates/${id}`, 'admin', { name: 'Updated' })).status, 200);
  assert.equal((await send('POST', '/api/review-templates', 'hr', { ...body(), createdBy: user })).status, 400);
});

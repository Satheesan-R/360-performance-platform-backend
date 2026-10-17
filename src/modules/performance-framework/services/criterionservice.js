const mongoose = require('mongoose');
const Framework = require('../models/performanceframework');
const Organization = require('../../organization/models/organization');
const { fail, objectId } = require('../../organization/services/validation');
const { parseCriterion, scoringSummary, requireValidWeights } = require('./criteriavalidation');
const { requireScoringReady } = require('./scoringvalidation');

async function loadFramework(id) {
  objectId(id, 'frameworkId');
  const organization = await Organization.findOne({ singletonKey: 'company' });
  if (!organization) fail('Set up the organization before managing criteria', 409);
  const framework = await Framework.findOne({ _id: id, organizationId: organization._id }).lean();
  if (!framework) fail('Performance framework was not found', 404);
  return framework;
}

function versionFilter(framework) {
  return { _id: framework._id, organizationId: framework.organizationId,
    __v: framework.__v === undefined ? { $exists: false } : framework.__v };
}

async function listCriteria(frameworkId, kind, query) {
  if (query.status !== undefined && !['active', 'inactive'].includes(query.status)) fail('status must be active or inactive');
  if (query.search !== undefined && (typeof query.search !== 'string' || query.search.length > 200)) fail('search must be text up to 200 characters');
  const framework = await loadFramework(frameworkId);
  const search = (query.search || '').trim().toLowerCase();
  const items = (framework[kind] || []).filter((item) =>
    (!query.status || (item.status || 'active') === query.status) &&
    (!search || `${item.name} ${item.description || ''}`.toLowerCase().includes(search)));
  return { frameworkId: framework._id, [kind]: items, scoring: scoringSummary(framework) };
}

async function mutateCriterion(frameworkId, kind, itemId, body) {
  if (itemId !== null) objectId(itemId, 'criterionId');
  const data = parseCriterion(body, kind, itemId === null);
  const framework = await loadFramework(frameworkId);
  if (framework.status === 'archived') fail('Move the framework to draft before editing archived criteria', 409);
  const items = [...(framework[kind] || [])];
  let index;
  const now = new Date();
  if (itemId === null) {
    if (items.length >= 100) fail('A framework can contain at most 100 items per criterion type');
    index = items.length;
    items.push({ _id: new mongoose.Types.ObjectId(), description: '', status: 'active', ...data, createdAt: now, updatedAt: now });
  } else {
    index = items.findIndex((item) => String(item._id).toLowerCase() === itemId.toLowerCase());
    if (index === -1) fail('Criterion was not found', 404);
    items[index] = { ...items[index], ...data, updatedAt: now };
  }
  if (framework.status === 'active') requireScoringReady({ ...framework, [kind]: items });
  const updated = await Framework.findOneAndUpdate(versionFilter(framework),
    { $set: { [kind]: items }, $inc: { __v: 1 } }, { new: true, runValidators: true }).lean();
  if (!updated) fail('Framework changed while saving. Reload and try again', 409);
  return { criterion: updated[kind][index], scoring: scoringSummary(updated) };
}

module.exports = { loadFramework, versionFilter, listCriteria, mutateCriterion };

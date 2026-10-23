const Snapshot = require('../models/frameworksnapshot');
const { loadFramework } = require('./criterionservice');
const { requireScoringReady, settings } = require('./scoringvalidation');
const { fail, objectId } = require('../../organization/services/validation');

function snapshotConfiguration(framework) {
  // Detached JSON captures labels, criterion targets and rules, not live refs.
  return JSON.parse(JSON.stringify({ name: framework.name, description: framework.description || '',
    applicableEmploymentTypeIds: framework.applicableEmploymentTypeIds || [], applicableJobRoles: framework.applicableJobRoles || [],
    competencies: framework.competencies || [], kpis: framework.kpis || [], ...settings(framework), scoringFormulaVersion: 1 }));
}

async function createSnapshot(id, userId, body) {
  objectId(userId, 'createdBy');
  if (body !== undefined && (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length)) fail('Snapshot creation does not accept configuration overrides');
  const framework = await loadFramework(id);
  if (framework.status !== 'active') fail('Only active frameworks can be snapshotted for review cycles', 409);
  requireScoringReady(framework);
  const filter = { organizationId: framework.organizationId, frameworkId: framework._id, sourceVersion: framework.__v ?? 0 };
  const existing = await Snapshot.findOne(filter).lean();
  if (existing) return existing;
  try {
    return await Snapshot.create({ ...filter, configuration: snapshotConfiguration(framework), createdBy: userId });
  } catch (error) {
    if (error.code !== 11000) throw error;
    const concurrent = await Snapshot.findOne(filter).lean();
    if (!concurrent) throw error;
    return concurrent;
  }
}

async function getSnapshot(id, snapshotId) {
  objectId(snapshotId, 'snapshotId');
  const framework = await loadFramework(id);
  const snapshot = await Snapshot.findOne({ _id: snapshotId, frameworkId: framework._id, organizationId: framework.organizationId }).lean();
  if (!snapshot) fail('Framework snapshot was not found', 404);
  return snapshot;
}

module.exports = { createSnapshot, getSnapshot, snapshotConfiguration };

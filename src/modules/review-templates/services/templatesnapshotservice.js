const Snapshot = require('../models/templatesnapshot');
const { getTemplate } = require('./templateservice');
const { frameworkForTemplate, requireTemplateReady } = require('./templaterelations');
const { fail, objectId } = require('../../organization/services/validation');

async function createSnapshot(id, userId, body) {
  objectId(userId, 'createdBy');
  if (body !== undefined && (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length)) fail('Template snapshot creation does not accept overrides');
  const template = await getTemplate(id);
  const framework = frameworkForTemplate(template);
  if (template.status !== 'active' || !framework) fail('Activate the template before creating a review-cycle snapshot', 409);
  requireTemplateReady(template, framework);
  const filter = { organizationId: template.organizationId, templateId: template._id, sourceVersion: template.__v ?? 0 };
  const existing = await Snapshot.findOne(filter).lean();
  if (existing) return existing;
  const configuration = JSON.parse(JSON.stringify({ name: template.name, description: template.description || '', frameworkId: template.frameworkId,
    reviewType: template.reviewType ?? null,
    departmentIds: template.departmentIds || [],
    targetRole: template.targetRole ?? null,
    approvalStatus: template.approvalStatus ?? 'not_submitted',
    approvedBy: template.approvedBy ?? null,
    approvedAt: template.approvedAt ?? null,
    employmentTypeIds: template.employmentTypeIds || [], sections: template.sections || [], evidenceRequired: Boolean(template.evidenceRequired),
    frameworkVersion: template.frameworkVersion, framework: template.frameworkSnapshot }));
  try { return await Snapshot.create({ ...filter, configuration, createdBy: userId }); }
  catch (error) {
    if (error.code !== 11000) throw error;
    const concurrent = await Snapshot.findOne(filter).lean();
    if (!concurrent) throw error;
    return concurrent;
  }
}

async function getSnapshot(id, snapshotId) {
  objectId(snapshotId, 'snapshotId');
  const template = await getTemplate(id);
  const snapshot = await Snapshot.findOne({ _id: snapshotId, templateId: template._id, organizationId: template.organizationId }).lean();
  if (!snapshot) fail('Review template snapshot was not found', 404);
  return snapshot;
}

module.exports = { createSnapshot, getSnapshot };

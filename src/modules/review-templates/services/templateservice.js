const Template = require('../models/reviewtemplate');
const Organization = require('../../organization/models/organization');
const User = require('../../auth/models/usermodel');
const { fail, objectId, pagination } = require('../../organization/services/validation');
const { parseTemplate, validateEmbeddedIds } = require('./templatevalidation');
const relations = require('./templaterelations');
const { snapshotConfiguration } = require('../../performance-framework/services/snapshotservice');

async function company() {
  const organization = await Organization.findOne({ singletonKey: 'company' });
  if (!organization) fail('Set up the organization before managing review templates', 409);
  return organization;
}

async function getTemplate(id) {
  objectId(id, 'templateId');
  const organization = await company();
  const template = await Template.findOne({ _id: id, organizationId: organization._id }).lean();
  if (!template) fail('Review template was not found', 404);
  return template;
}

async function createTemplate(body, userId) {
  const data = parseTemplate(body, true);
  objectId(userId, 'createdBy');
  validateEmbeddedIds(data.sections);
  const organization = await company();
  if (!await User.exists({ _id: userId, status: 'active', role: { $in: ['hr', 'admin'] } })) fail('An active HR or admin account is required', 403);
  const candidate = { ...data, organizationId: organization._id };
  const framework = await relations.resolveFramework(candidate);
  if (framework.status === 'archived') fail('Choose a draft or active framework');
  await relations.validateEmploymentTypes(candidate, framework);
  relations.validateCriteria(candidate, framework);
  if (data.status === 'active') {
    relations.requireTemplateReady(candidate, framework);
    data.frameworkSnapshot = snapshotConfiguration(framework);
    data.frameworkVersion = framework.__v ?? 0;
  }
  return Template.create({ ...data, organizationId: organization._id, createdBy: userId });
}

async function updateTemplate(id, body) {
  const data = parseTemplate(body);
  const existing = await getTemplate(id);
  const status = data.status || existing.status;
  const switching = data.frameworkId !== undefined && String(data.frameworkId) !== String(existing.frameworkId);
  if (switching && status !== 'draft') fail('Move the template to draft before switching frameworks', 409);
  if (existing.status === 'archived' && status !== 'draft' && (data.sections || switching)) fail('Move the template to draft before editing archived sections', 409);
  if (data.sections) validateEmbeddedIds(data.sections, existing.sections);
  const candidate = { ...existing, ...data };
  const frozen = !switching && status !== 'draft' ? relations.frameworkForTemplate(existing) : null;
  const framework = frozen || await relations.resolveFramework(candidate);
  if (status !== 'archived') {
    if (!frozen && framework.status === 'archived') fail('Choose a draft or active framework');
    relations.validateCriteria(candidate, framework);
    if (Object.hasOwn(data, 'employmentTypeIds') || (status === 'active' && existing.status !== 'active') || switching) await relations.validateEmploymentTypes(candidate, framework);
    if (status === 'active') {
      relations.requireTemplateReady(candidate, framework);
      data.frameworkSnapshot = snapshotConfiguration(framework);
      data.frameworkVersion = framework.__v ?? 0;
    }
  }
  if (status === 'draft') { data.frameworkSnapshot = null; data.frameworkVersion = null; }
  const filter = { _id: existing._id, organizationId: existing.organizationId, __v: existing.__v === undefined ? { $exists: false } : existing.__v };
  const updated = await Template.findOneAndUpdate(filter, { $set: data, $inc: { __v: 1 } }, { new: true, runValidators: true }).lean();
  if (!updated) fail('Template changed while saving. Reload and try again', 409);
  return updated;
}

async function listTemplates(query) {
  const { page, limit } = pagination(query);
  const organization = await company();
  const filter = { organizationId: organization._id };
  if (query.status !== undefined) {
    if (!['draft', 'active', 'archived'].includes(query.status)) fail('status must be draft, active or archived');
    filter.status = query.status;
  }
  if (query.frameworkId !== undefined) filter.frameworkId = objectId(query.frameworkId, 'frameworkId');
  if (query.employmentTypeId !== undefined) filter.employmentTypeIds = objectId(query.employmentTypeId, 'employmentTypeId');
  if (query.search !== undefined) {
    if (typeof query.search !== 'string' || query.search.length > 200) fail('search must be text up to 200 characters');
    const escaped = query.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [{ name: { $regex: escaped, $options: 'i' } }, { description: { $regex: escaped, $options: 'i' } }];
  }
  const [templates, total] = await Promise.all([
    Template.find(filter).select('-frameworkSnapshot').sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit)
      .populate('frameworkId', 'name status').populate('employmentTypeIds', 'name code isActive').lean(),
    Template.countDocuments(filter),
  ]);
  return { templates, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
}

module.exports = { createTemplate, getTemplate, updateTemplate, listTemplates };

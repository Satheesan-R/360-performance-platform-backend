const Framework = require('../models/performanceframework');
const Organization = require('../../organization/models/organization');
const EmploymentType = require('../../organization/models/employmenttype');
const User = require('../../auth/models/usermodel');
const { fail, objectId, pagination } = require('../../organization/services/validation');

const statuses = ['draft', 'active', 'archived'];
const allowed = ['name', 'description', 'applicableEmploymentTypeIds', 'applicableJobRoles', 'status'];
const populate = [
  { path: 'applicableEmploymentTypeIds', select: 'name code isActive' },
  { path: 'createdBy', select: 'email role' },
];

function parseFields(body, create = false) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('A JSON object is required');
  const unknown = Object.keys(body).filter((key) => !allowed.includes(key));
  if (unknown.length) fail(`Unknown fields: ${unknown.join(', ')}`);
  if (!Object.keys(body).length) fail('At least one field is required');
  const data = {};
  for (const key of ['name', 'description']) {
    if (Object.hasOwn(body, key)) {
      if (typeof body[key] !== 'string') fail(`${key} must be text`);
      data[key] = body[key].trim();
      if (data[key].length > (key === 'description' ? 2000 : 200)) fail(`${key} is too long`);
    }
  }
  if ((create || Object.hasOwn(data, 'name')) && !data.name) fail('name is required');
  if (Object.hasOwn(body, 'status')) {
    if (!statuses.includes(body.status)) fail('status must be draft, active or archived');
    data.status = body.status;
  }
  for (const key of ['applicableEmploymentTypeIds', 'applicableJobRoles']) {
    if (!Object.hasOwn(body, key)) continue;
    if (!Array.isArray(body[key]) || body[key].length > 100) fail(`${key} must be an array of at most 100 items`);
    data[key] = body[key].map((value) => {
      if (key === 'applicableEmploymentTypeIds') return objectId(value, key).toLowerCase();
      if (typeof value !== 'string' || !value.trim() || value.trim().length > 200) fail('Job roles must be non-empty text up to 200 characters');
      return value.trim();
    });
    if (new Set(data[key].map((value) => value.toLowerCase())).size !== data[key].length) fail(`${key} must not contain duplicates`);
  }
  return data;
}

async function company() {
  const organization = await Organization.findOne({ singletonKey: 'company' });
  if (!organization) fail('Set up the organization before managing performance frameworks', 409);
  return organization;
}

async function validateEmploymentTypes(ids, organizationId) {
  if (!ids || !ids.length) return;
  const count = await EmploymentType.countDocuments({ _id: { $in: ids }, organizationId, isActive: true });
  if (count !== ids.length) fail('Applicable employment types must exist, be active and belong to this organization');
}

function overview(record) {
  const data = typeof record.toObject === 'function' ? record.toObject() : record;
  // No competencies, KPIs or scoring configuration can be attached in this milestone.
  return { ...data, competencyCount: 0, kpiCount: 0, ratingScale: null };
}

async function createFramework(body, userId) {
  const data = parseFields(body, true);
  objectId(userId, 'createdBy');
  const organization = await company();
  if (!await User.exists({ _id: userId, status: 'active', role: { $in: ['hr', 'admin'] } })) {
    fail('An active HR or admin account is required', 403);
  }
  await validateEmploymentTypes(data.applicableEmploymentTypeIds, organization._id);
  const framework = await Framework.create({ ...data, organizationId: organization._id, createdBy: userId });
  await framework.populate(populate);
  return overview(framework);
}

async function getFramework(id) {
  objectId(id, 'frameworkId');
  const organization = await company();
  const framework = await Framework.findOne({ _id: id, organizationId: organization._id }).populate(populate).lean();
  if (!framework) fail('Performance framework was not found', 404);
  return overview(framework);
}

async function updateFramework(id, body) {
  objectId(id, 'frameworkId');
  const data = parseFields(body);
  const organization = await company();
  await validateEmploymentTypes(data.applicableEmploymentTypeIds, organization._id);
  const framework = await Framework.findOneAndUpdate({ _id: id, organizationId: organization._id }, { $set: data }, { new: true, runValidators: true }).populate(populate);
  if (!framework) fail('Performance framework was not found', 404);
  return overview(framework);
}

async function listFrameworks(query) {
  const { page, limit } = pagination(query);
  const organization = await company();
  const filter = { organizationId: organization._id };
  if (query.status !== undefined) {
    if (!statuses.includes(query.status)) fail('status must be draft, active or archived');
    filter.status = query.status;
  }
  if (query.employmentTypeId !== undefined) filter.applicableEmploymentTypeIds = objectId(query.employmentTypeId, 'employmentTypeId');
  if (query.search !== undefined) {
    if (typeof query.search !== 'string' || query.search.length > 200) fail('search must be text up to 200 characters');
    const escaped = query.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = ['name', 'description', 'applicableJobRoles'].map((key) => ({ [key]: { $regex: escaped, $options: 'i' } }));
  }
  const [frameworks, total] = await Promise.all([
    Framework.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).populate(populate).lean(),
    Framework.countDocuments(filter),
  ]);
  return { frameworks: frameworks.map(overview), pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
}

async function getSummary() {
  const organization = await company();
  const counts = await Promise.all(statuses.map((status) => Framework.countDocuments({ organizationId: organization._id, status })));
  return { total: counts.reduce((sum, count) => sum + count, 0), draft: counts[0], active: counts[1], archived: counts[2] };
}

module.exports = { createFramework, getFramework, updateFramework, listFrameworks, getSummary, parseFields };

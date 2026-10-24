const Cycle = require('../models/reviewcycle');
const User = require('../../auth/models/usermodel');
const Employee = require('../../auth/models/employee');
const Department = require('../../organization/models/department');
const Organization = require('../../organization/models/organization');
const { getTemplate } = require('../../review-templates/services/templateservice');
const { createSnapshot } = require('../../review-templates/services/templatesnapshotservice');
const { ready } = require('../../review-templates/services/templateapproval');
const { fail, objectId, pagination } = require('../../organization/services/validation');

function ids(value, field, required = false) {
  if (!Array.isArray(value) || value.length > 500 || (required && !value.length)) fail(`${field} must be ${required ? 'a non-empty' : 'an'} array of at most 500 IDs`);
  const normalized = value.map((id) => objectId(id, field).toLowerCase());
  if (new Set(normalized).size !== normalized.length) fail(`${field} must not contain duplicates`);
  return normalized;
}

function date(value, field) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)) fail(`${field} must be an ISO date or timestamp with timezone`);
  const parsed = new Date(value);
  const day = new Date(value.slice(0, 10));
  if (!Number.isFinite(parsed.getTime()) || !Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== value.slice(0, 10)) fail(`${field} must be a valid date`);
  return parsed;
}

async function organization() {
  const company = await Organization.findOne({ singletonKey: 'company' });
  if (!company) fail('Set up the organization first', 409);
  return company;
}

async function approvedTemplate(id) {
  const template = await getTemplate(id);
  if (template.status !== 'active' || template.approvalStatus !== 'approved' || template.targetRole !== 'department_manager') {
    fail('Choose an active, admin-approved department-manager template', 409);
  }
  await ready(template);
  return template;
}

async function createCycle(body, userId) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((key) => !['name', 'templateId', 'departmentIds', 'employeeIds', 'startDate', 'endDate'].includes(key))) fail('Invalid cycle fields');
  if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 200) fail('name must contain 1 to 200 characters');
  objectId(userId, 'createdBy');
  objectId(body.templateId, 'templateId');
  const employeeIds = ids(body.employeeIds, 'employeeIds', true);
  const requestedDepartments = body.departmentIds === undefined ? [] : ids(body.departmentIds, 'departmentIds');
  const startDate = date(body.startDate, 'startDate');
  const endDate = date(body.endDate, 'endDate');
  if (startDate >= endDate) fail('endDate must be after startDate');
  if (!await User.exists({ _id: userId, role: 'hr', status: 'active' })) fail('Only active HR users may create review cycles', 403);

  const template = await approvedTemplate(body.templateId);
  const allowedDepartments = (template.departmentIds || []).map(String);
  if (allowedDepartments.length && requestedDepartments.some((id) => !allowedDepartments.includes(id))) fail('Cycle departments must match the approved template');
  const departmentIds = requestedDepartments.length ? requestedDepartments : allowedDepartments;
  if (departmentIds.length && await Department.countDocuments({ _id: { $in: departmentIds }, organizationId: template.organizationId, status: 'active' }) !== departmentIds.length) fail('Cycle departments must be active and belong to the company');

  const participants = await Employee.find({
    _id: { $in: employeeIds },
    $or: [{ organizationId: template.organizationId }, { organizationId: null }],
  }).select('_id departmentId employmentTypeId jobTitle').lean();
  if (participants.length !== employeeIds.length) fail('Selected employees must belong to this organization');
  const types = (template.employmentTypeIds?.length ? template.employmentTypeIds : template.frameworkSnapshot.applicableEmploymentTypeIds || []).map(String);
  const jobs = (template.frameworkSnapshot.applicableJobRoles || []).map((title) => title.toLowerCase());
  for (const employee of participants) {
    if (departmentIds.length && !departmentIds.includes(String(employee.departmentId))) fail('Selected managers must belong to the cycle departments');
    if (types.length && !types.includes(String(employee.employmentTypeId))) fail('Selected managers must match template employment types');
    if (jobs.length && !jobs.includes((employee.jobTitle || '').trim().toLowerCase())) fail('Selected managers must match the framework job roles');
  }
  const managerCount = await User.countDocuments({ employee: { $in: employeeIds }, role: 'department_manager', status: 'active' });
  if (managerCount !== employeeIds.length) fail('Every selected employee must have an active department_manager account');

  const snapshot = await createSnapshot(String(template._id), userId);
  const configuration = snapshot.configuration;
  if (snapshot.sourceVersion !== (template.__v ?? 0) || configuration.approvalStatus !== 'approved' || configuration.targetRole !== 'department_manager') fail('Template approval changed while creating the cycle. Reload and try again', 409);
  return Cycle.create({
    organizationId: template.organizationId, name: body.name.trim(), templateId: template._id,
    templateSnapshotId: snapshot._id, templateVersion: snapshot.sourceVersion,
    departmentIds, employeeIds, startDate, endDate, targetRole: 'department_manager', status: 'draft', createdBy: userId,
  });
}

async function listCycles(query) {
  const { page, limit } = pagination(query);
  const company = await organization();
  const filter = { organizationId: company._id };
  const [cycles, total] = await Promise.all([
    Cycle.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Cycle.countDocuments(filter),
  ]);
  return { cycles, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
}

async function getCycle(id) {
  objectId(id, 'cycleId');
  const company = await organization();
  const cycle = await Cycle.findOne({ _id: id, organizationId: company._id }).lean();
  if (!cycle) fail('Review cycle was not found', 404);
  return cycle;
}

module.exports = { createCycle, listCycles, getCycle };

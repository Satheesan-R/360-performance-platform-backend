const Cycle = require('../models/reviewcycle');
const Response = require('../models/reviewresponse');
const { saveResponse, participantResult } = require('./reviewresponses');
const Snapshot = require('../../review-templates/models/templatesnapshot');
const { createSnapshot } = require('../../review-templates/services/templatesnapshotservice');
const User = require('../../auth/models/usermodel');
const Employee = require('../../auth/models/employee');
const Department = require('../../organization/models/department');
const Organization = require('../../organization/models/organization');
const { getTemplate } = require('../../review-templates/services/templateservice');
const { ready } = require('../../review-templates/services/templateapproval');
const { fail, objectId, pagination } = require('../../organization/services/validation');
const { validateReviewerAssignments } = require('./reviewerassignments');
const draftFields = ['name', 'templateId', 'departmentIds', 'employeeIds', 'startDate', 'endDate', 'reviewerAssignments'];

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
  if (template.status !== 'active' || template.approvalStatus !== 'approved') {
    fail('Choose an active, admin-approved template', 409);
  }
  await ready(template);
  return template;
}

async function validateDraft(body, userId) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((key) => !draftFields.includes(key))) fail('Invalid cycle fields');
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
  }).select('_id departmentId employmentTypeId jobTitle managerId').lean();
  if (participants.length !== employeeIds.length) fail('Selected employees must belong to this organization');
  const types = (template.employmentTypeIds?.length ? template.employmentTypeIds : template.frameworkSnapshot.applicableEmploymentTypeIds || []).map(String);
  const jobs = (template.frameworkSnapshot.applicableJobRoles || []).map((title) => title.toLowerCase());
  for (const employee of participants) {
    if (departmentIds.length && !departmentIds.includes(String(employee.departmentId))) fail('Selected participants must belong to the cycle departments');
    if (types.length && !types.includes(String(employee.employmentTypeId))) fail('Selected participants must match template employment types');
    if (jobs.length && !jobs.includes((employee.jobTitle || '').trim().toLowerCase())) fail('Selected participants must match the framework job roles');
  }
  const participantCount = await User.countDocuments({ employee: { $in: employeeIds }, role: template.targetRole, status: 'active' });
  if (participantCount !== employeeIds.length) fail(`Every selected participant must have an active ${template.targetRole} account`);
  const reviewerAssignments = await validateReviewerAssignments(
    Object.hasOwn(body, 'reviewerAssignments') ? body.reviewerAssignments : [], participants, template,
  );

  return { template, data: {
    organizationId: template.organizationId, name: body.name.trim(), templateId: template._id,
    departmentIds, employeeIds, reviewerAssignments, startDate, endDate, targetRole: template.targetRole,
  } };
}

async function createCycle(body, userId) {
  const { data } = await validateDraft(body, userId);
  return Cycle.create({ ...data, status: 'draft', createdBy: userId });
}

async function updateCycle(id, body, userId) {
  const allowed = [...draftFields, 'version'];
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((key) => !allowed.includes(key))) fail('Invalid cycle fields');
  if (!Number.isSafeInteger(body.version) || body.version < 0) fail('version must be the non-negative integer returned as __v');
  if (!Object.keys(body).some((key) => key !== 'version')) fail('At least one draft field is required');
  const cycle = await getCycle(id);
  if (cycle.status !== 'draft') fail('Only draft cycles can be edited', 409);
  if ((cycle.__v ?? 0) !== body.version) fail('Cycle changed. Reload and try again', 409);
  const { data } = await validateDraft(draftValues(cycle, body), userId);
  const updated = await Cycle.findOneAndUpdate(draftFilter(cycle), { $set: data, $unset: { templateSnapshotId: '', templateVersion: '' }, $inc: { __v: 1 } }, { new: true, runValidators: true }).lean();
  if (!updated) fail('Cycle changed. Reload and try again', 409);
  return updated;
}

function draftFilter(cycle) {
  return {
    _id: cycle._id, organizationId: cycle.organizationId, status: 'draft',
    __v: cycle.__v === undefined ? { $exists: false } : cycle.__v,
  };
}

function draftValues(cycle, body = {}) {
  const merged = {};
  for (const key of draftFields) {
    merged[key] = Object.hasOwn(body, key) ? body[key] : cycle[key];
  }
  if (!Object.hasOwn(body, 'templateId')) merged.templateId = String(merged.templateId);
  // Stored dates are Date instances; JSON inputs must still pass strict date validation.
  for (const key of ['startDate', 'endDate']) {
    if (!Object.hasOwn(body, key)) merged[key] = new Date(merged[key]).toISOString();
  }
  for (const key of ['employeeIds', 'departmentIds']) {
    if (!Object.hasOwn(body, key)) merged[key] = (merged[key] || []).map(String);
  }
  if (!Object.hasOwn(body, 'reviewerAssignments')) {
    merged.reviewerAssignments = (cycle.reviewerAssignments || []).map(({ employeeId, reviewerEmployeeId, role }) => ({
      employeeId: String(employeeId), reviewerEmployeeId: String(reviewerEmployeeId), role,
    }));
  }
  return merged;
}

async function publishCycle(id, body, userId) {
  if (!body || Object.keys(body).length !== 1 || !Number.isSafeInteger(body.version) || body.version < 0) {
    fail('Supply the saved draft version');
  }
  const cycle = await getCycle(id);
  if (cycle.status !== 'draft' || (cycle.__v ?? 0) !== body.version) {
    fail('Cycle changed or is already published. Reload and try again', 409);
  }
  const { template, data } = await validateDraft(draftValues(cycle), userId);
  const assigned = new Set(data.reviewerAssignments.map(({ employeeId }) => employeeId));
  if (data.employeeIds.some((employeeId) => !assigned.has(employeeId))) {
    fail('Assign at least one reviewer to each participant before publishing', 400);
  }
  const snapshot = await createSnapshot(String(template._id), userId);
  if (snapshot.sourceVersion !== (template.__v ?? 0) || snapshot.configuration.approvalStatus !== 'approved') {
    fail('Template approval changed. Reload the draft before publishing', 409);
  }
  const updated = await Cycle.findOneAndUpdate(draftFilter(cycle), {
    $set: { ...data, status: 'published', publishedAt: new Date(), templateSnapshotId: snapshot._id, templateVersion: snapshot.sourceVersion },
    $inc: { __v: 1 },
  }, { new: true, runValidators: true }).lean();
  if (!updated) fail('Cycle changed. Reload and try again', 409);
  return updated;
}

async function assignedScope(userId) {
  const [company, account] = await Promise.all([
    organization(),
    User.findOne({ _id: userId, status: 'active' }).select('employee').lean(),
  ]);
  return { company, employeeId: account?.employee };
}

async function listAssignedCycles(userId, query) {
  const { page, limit } = pagination(query);
  const { company, employeeId } = await assignedScope(userId);
  if (!employeeId) return { cycles: [], pagination: { page, limit, total: 0, totalPages: 0 } };
  const filter = { organizationId: company._id, status: 'published', 'reviewerAssignments.reviewerEmployeeId': employeeId };
  const [cycles, total] = await Promise.all([
    Cycle.find(filter).select('name startDate endDate').sort({ publishedAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Cycle.countDocuments(filter),
  ]);
  return { cycles, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
}

async function getAssignedReview(id, userId) {
  objectId(id, 'cycleId');
  const { company, employeeId } = await assignedScope(userId);
  const cycle = employeeId && await Cycle.findOne({
    _id: id, organizationId: company._id, status: 'published', 'reviewerAssignments.reviewerEmployeeId': employeeId,
  }).lean();
  if (!cycle) fail('Assigned review was not found', 404);
  const assignments = cycle.reviewerAssignments.filter((assignment) => String(assignment.reviewerEmployeeId) === String(employeeId));
  if (!assignments.length) fail('Assigned review was not found', 404);
  const [snapshot, participants] = await Promise.all([
    Snapshot.findOne({ _id: cycle.templateSnapshotId, templateId: cycle.templateId, organizationId: company._id }).lean(),
    Employee.find({ _id: { $in: assignments.map((assignment) => assignment.employeeId) } }).select('firstName lastName').lean(),
  ]);
  if (!snapshot) fail('The published review form is unavailable', 409);
  const configuration = snapshot.configuration;
  const framework = configuration.framework;
  const resolve = (ids, entries) => (ids || []).map((id) =>
    (entries || []).find((entry) => String(entry._id) === String(id)) || { _id: id, missing: true });
  return {
    name: cycle.name, templateName: configuration.name, description: configuration.description,
    ratingScale: framework.ratingScale ?? null,
    sections: configuration.sections.map((section) => ({
      ...section,
      competencies: resolve(section.competencyIds, framework.competencies),
      kpis: resolve(section.kpiIds, framework.kpis),
      evidenceRequired: Boolean(configuration.evidenceRequired || section.evidenceRequired),
    })),
    assignments: assignments.map(({ employeeId, role }) => {
      const person = participants.find((employee) => String(employee._id) === String(employeeId));
      return { employeeId, role, participantName: person ? [person.firstName, person.lastName].filter(Boolean).join(' ') : '' };
    }),
  };
}

async function listCycles(query) {
  const { page, limit } = pagination(query);
  const company = await organization();
  const filter = { organizationId: company._id };
  const [cycles, total] = await Promise.all([
    Cycle.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Cycle.countDocuments(filter),
  ]);
  return { cycles: cycles.map(withReviewerAssignments), pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
}

function withReviewerAssignments(cycle) {
  return { ...cycle, reviewerAssignments: cycle.reviewerAssignments ?? [] };
}

async function getCycle(id) {
  objectId(id, 'cycleId');
  const company = await organization();
  const cycle = await Cycle.findOne({ _id: id, organizationId: company._id }).lean();
  if (!cycle) fail('Review cycle was not found', 404);
  return withReviewerAssignments(cycle);
}

async function responseScope(cycleId, participantId, userId) {
  const id = objectId(cycleId, 'cycleId');
  const participant = objectId(participantId, 'participantId').toLowerCase();
  const { company, employeeId } = await assignedScope(userId);
  const filter = { cycleId: id, employeeId: participant, reviewerEmployeeId: employeeId };
  const cycle = employeeId && await Cycle.findOne({
    _id: id, organizationId: company._id, status: 'published',
    reviewerAssignments: { $elemMatch: { employeeId: participant, reviewerEmployeeId: employeeId } },
  }).lean();
  if (!cycle || !cycle.reviewerAssignments.some((assignment) =>
    String(assignment.employeeId) === participant && String(assignment.reviewerEmployeeId) === String(employeeId))) {
    fail('Assigned review was not found', 404);
  }
  return { cycle, filter };
}

async function publishedConfiguration(cycle) {
  const snapshot = await Snapshot.findOne({
    _id: cycle.templateSnapshotId, templateId: cycle.templateId, organizationId: cycle.organizationId,
  }).lean();
  if (!snapshot) fail('The published review form is unavailable', 409);
  return snapshot.configuration;
}

async function getReviewResponse(cycleId, participantId, userId) {
  const { filter } = await responseScope(cycleId, participantId, userId);
  const response = await Response.findOne(filter).select('sections version submittedAt -_id').lean();
  return response || { sections: [], version: null, submittedAt: null };
}

async function saveReviewResponse(cycleId, participantId, userId, body) {
  const { cycle, filter } = await responseScope(cycleId, participantId, userId);
  return saveResponse(filter, body, await publishedConfiguration(cycle));
}

async function cycleResults(id) {
  const cycle = await getCycle(id);
  if (cycle.status !== 'published') fail('Publish this cycle before viewing results', 409);
  const [configuration, responses, participants] = await Promise.all([
    publishedConfiguration(cycle),
    Response.find({ cycleId: cycle._id, submittedAt: { $ne: null } }).lean(),
    Employee.find({ _id: { $in: cycle.employeeIds } }).select('firstName lastName').lean(),
  ]);
  return {
    name: cycle.name,
    maxRating: configuration.framework.ratingScale.max,
    participants: cycle.employeeIds.map((id) => {
      const employeeId = String(id);
      const person = participants.find((employee) => String(employee._id) === employeeId);
      return {
        employeeId,
        name: person ? [person.firstName, person.lastName].filter(Boolean).join(' ') : '',
        ...participantResult(
          cycle.reviewerAssignments.filter((assignment) => String(assignment.employeeId) === employeeId),
          responses.filter((response) => String(response.employeeId) === employeeId),
          configuration.framework,
        ),
      };
    }),
  };
}

module.exports = {
  createCycle, listCycles, getCycle, updateCycle, publishCycle, listAssignedCycles, getAssignedReview,
  getReviewResponse, saveReviewResponse, cycleResults,
};

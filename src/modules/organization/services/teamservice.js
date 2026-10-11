const Team = require('../models/team');
const Organization = require('../models/organization');
const Department = require('../models/department');
const Employee = require('../../auth/models/employee');
const { fail, objectId, fields, pagination } = require('./validation');

const allowed = ['name', 'code', 'departmentId', 'teamLeadEmployeeId', 'description', 'status'];
const populate = [
  { path: 'departmentId', select: 'name code status' },
  { path: 'teamLeadEmployeeId', select: 'employeeNumber firstName lastName workEmail' },
];

async function company() {
  const organization = await Organization.findOne({ singletonKey: 'company' });
  if (!organization) fail('Set up the organization before managing teams', 409);
  return organization;
}

async function validateRelationships(data, organizationId, requireActiveDepartment) {
  if (data.departmentId) {
    const department = await Department.findById(data.departmentId);
    if (!department) fail('Department was not found', 404);
    if (String(department.organizationId) !== String(organizationId)) fail('Department does not belong to this organization');
    if (requireActiveDepartment && department.status !== 'active') fail('Cannot use an inactive department for an active team');
  }
  if (data.teamLeadEmployeeId && !await Employee.exists({ _id: data.teamLeadEmployeeId })) {
    fail('Team lead employee was not found', 404);
  }
}

async function createTeam(body) {
  const data = fields(body, allowed, ['name', 'code', 'departmentId']);
  const organization = await company();
  // A new team must always be placed in an active department.
  await validateRelationships(data, organization._id, true);
  const team = await Team.create({ ...data, organizationId: organization._id });
  return team.populate(populate);
}

async function updateTeam(id, body) {
  objectId(id, 'teamId');
  const data = fields(body, allowed);
  const organization = await company();
  const team = await Team.findOne({ _id: id, organizationId: organization._id });
  if (!team) fail('Team was not found', 404);
  const activating = data.status === 'active' && team.status !== 'active';
  const relationships = { ...data };
  if (activating && !relationships.departmentId) relationships.departmentId = String(team.departmentId);
  await validateRelationships(relationships, organization._id, activating || Boolean(data.departmentId));
  Object.assign(team, data);
  await team.save();
  return team.populate(populate);
}

async function listTeams(query) {
  const { page, limit } = pagination(query);
  const organization = await company();
  const filter = { organizationId: organization._id };
  if (query.departmentId !== undefined) filter.departmentId = objectId(query.departmentId, 'departmentId');
  if (query.status !== undefined) {
    if (!['active', 'inactive'].includes(query.status)) fail('status must be active or inactive');
    filter.status = query.status;
  }
  if (query.search !== undefined) {
    if (typeof query.search !== 'string' || query.search.length > 200) fail('search must be text up to 200 characters');
    const escaped = query.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [{ name: { $regex: escaped, $options: 'i' } }, { code: { $regex: escaped, $options: 'i' } }];
  }
  const [teams, total] = await Promise.all([
    Team.find(filter).sort({ name: 1, _id: 1 }).skip((page - 1) * limit).limit(limit).populate(populate).lean(),
    Team.countDocuments(filter),
  ]);
  return { teams, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
}

module.exports = { createTeam, updateTeam, listTeams };

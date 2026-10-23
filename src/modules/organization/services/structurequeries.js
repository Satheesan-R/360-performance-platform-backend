const Organization = require('../models/organization');
const Department = require('../models/department');
const Team = require('../models/team');
const Employee = require('../../auth/models/employee');
const { fail, objectId, pagination } = require('./validation');

const employeeFields = 'employeeNumber firstName lastName workEmail jobTitle departmentId teamId managerId user onboardingStatus';
const employeeRelations = [
  { path: 'managerId', select: 'employeeNumber firstName lastName jobTitle' },
  { path: 'teamId', select: 'name code status' },
  { path: 'user', select: 'role status' },
];

async function company() {
  const organization = await Organization.findOne({ singletonKey: 'company' });

  if (!organization) {
    fail('Set up the organization before managing its structure', 409);
  }

  return organization;
}

function employeeScope(organizationId) {
  return { $or: [{ organizationId }, { organizationId: null }] };
}

async function departmentRecord(id, organizationId) {
  objectId(id, 'departmentId');

  const department = await Department.findOne({ _id: id, organizationId })
    .populate('headEmployeeId', 'employeeNumber firstName lastName jobTitle workEmail')
    .lean();

  if (!department) {
    fail('Department was not found', 404);
  }

  return department;
}

async function teamRecord(id, organizationId) {
  objectId(id, 'teamId');

  const team = await Team.findOne({ _id: id, organizationId })
    .populate('departmentId', 'name code status')
    .populate('teamLeadEmployeeId', 'employeeNumber firstName lastName jobTitle workEmail')
    .lean();

  if (!team) {
    fail('Team was not found', 404);
  }

  return team;
}

async function getDepartment(id) {
  const organization = await company();
  const department = await departmentRecord(id, organization._id);
  const [employeeCount, teamCount] = await Promise.all([
    Employee.countDocuments({ departmentId: department._id, ...employeeScope(organization._id) }),
    Team.countDocuments({ departmentId: department._id, organizationId: organization._id }),
  ]);

  return { ...department, employeeCount, teamCount };
}

async function getTeam(id) {
  const organization = await company();
  const team = await teamRecord(id, organization._id);
  const employeeCount = await Employee.countDocuments({
    teamId: team._id,
    departmentId: team.departmentId?._id ?? null,
    ...employeeScope(organization._id),
  });

  return { ...team, employeeCount };
}

async function employeeList(filter, query) {
  const { page, limit } = pagination(query);

  if (query.search !== undefined) {
    if (typeof query.search !== 'string' || query.search.length > 200) {
      fail('search must be text up to 200 characters');
    }

    const escaped = query.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const search = ['firstName', 'lastName', 'employeeNumber', 'workEmail', 'jobTitle']
      .map((field) => ({ [field]: { $regex: escaped, $options: 'i' } }));

    filter = { $and: [filter, { $or: search }] };
  }

  const [employees, total] = await Promise.all([
    Employee.find(filter)
      .select(employeeFields)
      .sort({ firstName: 1, lastName: 1, _id: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate(employeeRelations)
      .lean(),
    Employee.countDocuments(filter),
  ]);

  return { employees, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
}

async function departmentEmployees(id, query) {
  const organization = await company();
  const department = await departmentRecord(id, organization._id);

  return employeeList({ departmentId: department._id, ...employeeScope(organization._id) }, query);
}

async function teamEmployees(id, query) {
  const organization = await company();
  const team = await teamRecord(id, organization._id);

  return employeeList({
    teamId: team._id,
    departmentId: team.departmentId?._id ?? null,
    ...employeeScope(organization._id),
  }, query);
}

module.exports = {
  company,
  employeeScope,
  departmentRecord,
  employeeFields,
  employeeRelations,
  getDepartment,
  getTeam,
  departmentEmployees,
  teamEmployees,
};

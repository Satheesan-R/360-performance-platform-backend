const User = require('../../auth/models/usermodel');
const Employee = require('../../auth/models/employee');
const Organization = require('../../organization/models/organization');
const Team = require('../../organization/models/team');
const Department = require('../../organization/models/department');
const { belongsToCompany } = require('../../organization/services/hierarchyservice');
const mongoose = require('mongoose');
const { fail } = require('./validation');

const same = (a, b) => a != null && b != null && String(a) === String(b);
const contains = (values, id) => values.some((value) => same(value, id));

async function context(authUser) {
  if (!authUser || authUser.purpose || !mongoose.isObjectIdOrHexString(authUser.id)) fail('Login required', 401);
  const user = await User.findById(authUser.id).select('role status employee').lean();
  if (!user || user.status !== 'active') fail('Account unavailable', 401);
  const organization = await Organization.findOne({ singletonKey: 'company' }).lean();
  if (!organization) fail('Set up the organization before managing goals', 409);
  const employee = user.employee ? await Employee.findById(user.employee).lean() : null;
  if (employee && !belongsToCompany(employee, organization._id)) fail('Employee does not belong to this organization', 403);
  const admin = ['hr', 'admin'].includes(user.role);
  const manager = ['department_manager', 'tech_lead'].includes(user.role);
  const result = { user, organizationId: organization._id, employee, admin, managedTeamIds: [], visibleTeamIds: [], employeeIds: [] };
  if (admin) return result;
  if (!employee) fail('Link an employee profile before accessing goals', 403);

  // Role labels alone grant no access to other teams or departments.
  if (manager) {
    const departments = user.role === 'department_manager'
      ? await Department.find({ organizationId: organization._id, headEmployeeId: employee._id, status: 'active' }).select('_id').lean()
      : [];
    const teams = await Team.find({ organizationId: organization._id, status: 'active', $or: [
      { teamLeadEmployeeId: employee._id }, { departmentId: { $in: departments.map((d) => d._id) } },
    ] }).select('_id').lean();
    result.managedTeamIds = teams.map((team) => team._id);
    const filters = [{ _id: employee._id }, { managerId: employee._id }, { teamId: { $in: result.managedTeamIds } }];
    if (departments.length) filters.push({ departmentId: { $in: departments.map((d) => d._id) } });
    const employees = await Employee.find({ $and: [
      { $or: [{ organizationId: organization._id }, { organizationId: null }] }, { $or: filters },
    ] }).select('_id').lean();
    result.employeeIds = employees.map((item) => item._id);
  } else {
    result.employeeIds = [employee._id];
  }
  result.visibleTeamIds = [...result.managedTeamIds, ...(employee.teamId ? [employee.teamId] : [])];
  return result;
}

function canManage(ctx, goal) {
  if (!same(goal.organizationId, ctx.organizationId)) return false;
  if (ctx.admin) return true;
  if (goal.level === 'organization') return false;
  if (goal.level === 'team') return contains(ctx.managedTeamIds, goal.teamId);
  return contains(ctx.employeeIds, goal.ownerEmployeeId);
}

function visibility(ctx) {
  return ctx.admin ? {} : { $or: [
    { level: 'organization' },
    { level: 'team', teamId: { $in: ctx.visibleTeamIds } },
    { level: 'individual', ownerEmployeeId: { $in: ctx.employeeIds } },
  ] };
}

function requireAdmin(ctx) {
  if (!ctx.admin) fail('HR or admin access is required', 403);
}

function requireManage(ctx, goal) {
  if (!canManage(ctx, goal)) fail('You do not have permission to manage this goal', 403);
}

module.exports = { context, same, contains, canManage, visibility, requireAdmin, requireManage };

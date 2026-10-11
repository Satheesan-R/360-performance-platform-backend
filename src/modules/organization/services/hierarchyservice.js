const mongoose = require('mongoose');
const Organization = require('../models/organization');
const Employee = require('../../auth/models/employee');
require('../models/team');
const { fail, objectId } = require('./validation');

const populate = [
  { path: 'departmentId', select: 'name code status' },
  { path: 'teamId', select: 'name code status' },
  { path: 'managerId', select: 'firstName lastName employeeNumber jobTitle' },
];

function belongsToCompany(employee, organizationId) {
  // Before organization links existed, all employees belonged to this one company.
  return employee.organizationId == null || String(employee.organizationId) === String(organizationId);
}

async function listHierarchy(query) {
  if (query.search !== undefined && (typeof query.search !== 'string' || query.search.length > 200)) fail('search must be text up to 200 characters');
  const organization = await Organization.findOne({ singletonKey: 'company' });
  if (!organization) fail('Set up the organization before managing reporting relationships', 409);
  const employees = await Employee.find({ $or: [{ organizationId: organization._id }, { organizationId: null }] })
    .select('employeeNumber firstName lastName jobTitle department departmentId teamId manager managerId organizationId')
    .sort({ firstName: 1, lastName: 1, _id: 1 }).populate(populate).lean();
  const search = (query.search || '').trim().toLowerCase();
  const visible = employees.filter((employee) => !search ||
    `${employee.firstName} ${employee.lastName} ${employee.employeeNumber} ${employee.jobTitle || ''}`.toLowerCase().includes(search));
  return {
    organizationId: organization._id,
    employees: visible,
    rootEmployeeIds: employees.filter((employee) => !employee.managerId).map((employee) => employee._id),
    total: employees.length,
  };
}

async function validateManager(employeeId, managerId, organizationId, session) {
  if (managerId === null) return null;
  if (String(employeeId) === managerId) fail('An employee cannot report to themselves');
  const visited = new Set([String(employeeId)]);
  let currentId = managerId;
  let manager;
  while (currentId) {
    if (visited.has(String(currentId))) fail('This assignment would create a circular reporting relationship');
    visited.add(String(currentId));
    const current = await Employee.findById(currentId).session(session);
    if (!current) fail(manager ? 'The manager hierarchy contains a missing employee' : 'Manager employee was not found', manager ? 409 : 404);
    if (!belongsToCompany(current, organizationId)) fail('Manager and employee must belong to the same organization');
    if (!manager) manager = current;
    currentId = current.managerId;
  }
  return manager;
}

async function assignManager(employeeId, body) {
  objectId(employeeId, 'employeeId');
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 || !Object.hasOwn(body, 'managerId')) {
    fail('Provide only managerId, or null to remove the reporting manager');
  }
  const managerId = body.managerId === null ? null : objectId(body.managerId, 'managerId');
  if (employeeId === managerId) fail('An employee cannot report to themselves');
  await mongoose.connection.transaction(async (session) => {
    // Every hierarchy write touches the same company record. Concurrent edits
    // conflict and retry, so two individually valid edits cannot create a cycle.
    const organization = await Organization.findOneAndUpdate(
      { singletonKey: 'company' }, { $inc: { hierarchyVersion: 1 } }, { new: true, session, timestamps: false }
    );
    if (!organization) fail('Set up the organization before managing reporting relationships', 409);
    const employee = await Employee.findById(employeeId).session(session);
    if (!employee) fail('Employee was not found', 404);
    if (!belongsToCompany(employee, organization._id)) fail('Employee does not belong to this organization');
    const manager = await validateManager(employeeId, managerId, organization._id, session);
    await Employee.updateOne({ _id: employeeId }, { $set: {
      managerId,
      organizationId: organization._id,
      manager: manager ? `${manager.firstName} ${manager.lastName}`.trim() : '',
    } }, { session, runValidators: true });
    if (manager && manager.organizationId == null) {
      await Employee.updateOne({ _id: manager._id }, { $set: { organizationId: organization._id } }, { session, runValidators: true });
    }
  });
  return Employee.findById(employeeId).populate(populate);
}

module.exports = { listHierarchy, assignManager, validateManager, belongsToCompany };

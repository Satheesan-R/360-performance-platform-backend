const mongoose = require('mongoose');
const Organization = require('../models/organization');
const Department = require('../models/department');
const Team = require('../models/team');
const Employee = require('../../auth/models/employee');
const { fail, objectId } = require('./validation');
const { belongsToCompany } = require('./hierarchyservice');

async function withStructureLock(operation) {
  return mongoose.connection.transaction(async (session) => {
    const organization = await Organization.findOneAndUpdate(
      { singletonKey: 'company' },
      { $inc: { structureVersion: 1 } },
      { new: true, session, timestamps: false }
    );

    if (!organization) {
      fail('Set up the organization before changing employee assignments', 409);
    }

    return operation(organization, session);
  });
}

function assignmentId(body, field) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 || !Object.hasOwn(body, field)) {
    fail(`Provide only ${field}, or null to remove the assignment`);
  }

  return body[field] === null ? null : objectId(body[field], field);
}

async function employeeRecord(id, organizationId, session) {
  const employee = await Employee.findById(id).session(session);

  if (!employee) {
    fail('Employee was not found', 404);
  }

  if (!belongsToCompany(employee, organizationId)) {
    fail('Employee does not belong to this organization');
  }

  return employee;
}

async function activeDepartment(id, organizationId, session) {
  const department = await Department.findOne({ _id: id, organizationId }).session(session);

  if (!department) {
    fail('Department was not found', 404);
  }

  if (department.status !== 'active') {
    fail('Cannot assign employees to an inactive department');
  }

  return department;
}

function assignmentResponse(id) {
  return Employee.findById(id)
    .select('employeeNumber firstName lastName workEmail jobTitle departmentId teamId managerId')
    .populate('departmentId', 'name code status')
    .populate('teamId', 'name code status');
}

async function assignTeam(employeeId, body) {
  objectId(employeeId, 'employeeId');
  const teamId = assignmentId(body, 'teamId');

  await withStructureLock(async (organization, session) => {
    const employee = await employeeRecord(employeeId, organization._id, session);

    if (teamId !== null) {
      const team = await Team.findOne({ _id: teamId, organizationId: organization._id }).session(session);

      if (!team) {
        fail('Team was not found', 404);
      }

      if (team.status !== 'active') {
        fail('Cannot assign employees to an inactive team');
      }

      await activeDepartment(team.departmentId, organization._id, session);

      if (String(employee.departmentId) !== String(team.departmentId)) {
        fail('Assign the employee to the team department before assigning the team');
      }
    }

    await Employee.updateOne(
      { _id: employeeId },
      { $set: { teamId, organizationId: organization._id } },
      { session, runValidators: true }
    );
  });

  return assignmentResponse(employeeId);
}

async function assignDepartment(employeeId, body) {
  objectId(employeeId, 'employeeId');
  const departmentId = assignmentId(body, 'departmentId');

  await withStructureLock(async (organization, session) => {
    const employee = await employeeRecord(employeeId, organization._id, session);

    if (departmentId !== null) {
      await activeDepartment(departmentId, organization._id, session);
    }

    const changed = String(employee.departmentId ?? '') !== String(departmentId ?? '');

    await Employee.updateOne(
      { _id: employeeId },
      { $set: {
        departmentId,
        organizationId: organization._id,
        ...(changed || departmentId === null ? { teamId: null } : {}),
      } },
      { session, runValidators: true }
    );
  });

  return assignmentResponse(employeeId);
}

module.exports = { assignTeam, assignDepartment, withStructureLock };

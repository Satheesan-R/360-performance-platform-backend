const mongoose = require('mongoose');
const Correction = require('../models/profile-correction');
const Employee = require('../../auth/models/employee');
const Department = require('../../organization/models/department');
const Organization = require('../../organization/models/organization');
const { validateManager, belongsToCompany } = require('../../organization/services/hierarchyservice');
const { fail, fields } = require('./preferences');
const { text } = require('./profile-details');
const allowed = ['jobTitle', 'department', 'reportingManager'];
const { findActiveUser, profileDto } = require('./settingsservice');

function dto(value) {
  return { id: String(value._id), field: value.field, currentValue: value.currentValue, proposedValue: value.proposedValue, reason: value.reason, status: value.status, createdAt: value.createdAt, reviewedAt: value.reviewedAt, reviewNote: value.reviewNote || '', ...(value.employee?.firstName ? { requesterName: `${value.employee.firstName} ${value.employee.lastName}`.trim() } : {}) };
}
async function companyFor(user) {
  const company = await Organization.findOne({ singletonKey: 'company' });
  if (!company) fail('Set up the organization before requesting corrections', 409);
  if (user.employee && !belongsToCompany(user.employee, company._id)) fail('Employee does not belong to this organization', 403);
  return company;
}
async function list(authUser, review = false) {
  const user = await findActiveUser(authUser);
  const filter = { requester: user._id };
  if (review) {
    if (!['hr', 'admin'].includes(user.role)) fail('Only HR and admins can review correction requests', 403);
    const company = await companyFor(user);
    Object.assign(filter, { requester: { $ne: user._id }, organizationId: company._id, status: 'pending' });
  }
  return (await Correction.find(filter).sort({ createdAt: -1, _id: -1 }).limit(100).populate('employee', 'firstName lastName').lean()).map(dto);
}
async function create(authUser, body) {
  const user = await findActiveUser(authUser);
  if (!user.employee) fail('No employee profile linked to this account', 404);
  fields(body, ['field', 'proposedValue', 'reason']);
  if (!allowed.includes(body.field)) fail('Choose a supported employment field');
  const proposedValue = text(body.proposedValue, 120, 'Correct value', true);
  const reason = text(body.reason, 500, 'Reason', true);
  const currentValue = profileDto(user).employee[body.field] || '';
  if (currentValue === proposedValue) fail('The proposed value already matches your employment record');
  const company = await companyFor(user);
  const request = await Correction.create({ requester: user._id, employee: user.employee._id, organizationId: company._id, field: body.field, currentValue, proposedValue, reason });
  return dto(request);
}
async function review(authUser, id, body) {
  const user = await findActiveUser(authUser);
  if (!['hr', 'admin'].includes(user.role)) fail('Only HR and admins can review correction requests', 403);
  if (!/^[a-f\d]{24}$/i.test(id)) fail('Invalid correction request');
  fields(body, ['decision', 'note']);
  if (!['approved', 'rejected'].includes(body.decision)) fail('Choose approve or reject');
  const note = text(body.note ?? '', 500, 'Review note', body.decision === 'rejected');
  const company = await companyFor(user);
  let reviewed;
  // Employment changes and the review decision commit together. The company
  // version lock serializes hierarchy edits with the existing manager workflow.
  await mongoose.connection.transaction(async session => {
    await Organization.findOneAndUpdate({ _id: company._id }, { $inc: { hierarchyVersion: 1 } }, { session, timestamps: false });
    const request = await Correction.findOne({ _id: id, organizationId: company._id }).session(session);
    if (!request) fail('Correction request was not found', 404);
    if (String(request.requester) === String(user._id)) fail('You cannot review your own correction request', 403);
    if (request.status !== 'pending') fail('This request has already been reviewed', 409);
    const employee = await Employee.findById(request.employee).session(session);
    if (!employee || !belongsToCompany(employee, company._id)) fail('Employee is no longer available in this organization', 409);
    if (body.decision === 'approved') {
      const display = await Employee.findById(employee._id).session(session).populate('departmentId', 'name').populate('managerId', 'firstName lastName');
      const currentValue = request.field === 'jobTitle' ? employee.jobTitle || '' : request.field === 'department' ? display.departmentId?.name || employee.department || '' : display.managerId ? `${display.managerId.firstName} ${display.managerId.lastName}`.trim() : employee.manager || '';
      if (currentValue !== request.currentValue) fail('The official record changed after this request. Reject it and ask for an updated request', 409);
      const updates = { organizationId: company._id };
      if (request.field === 'jobTitle') updates.jobTitle = request.proposedValue;
      if (request.field === 'department') {
        const matches = await Department.find({ organizationId: company._id, status: 'active', name: request.proposedValue }).session(session).limit(2);
        if (matches.length !== 1) fail('The requested department must match exactly one active department', 409);
        updates.departmentId = matches[0]._id; updates.department = matches[0].name;
        // A team cannot remain attached to a different department.
        updates.teamId = null;
      }
      if (request.field === 'reportingManager') {
        const target = await Employee.findOne({ employeeNumber: request.proposedValue, $or: [{ organizationId: company._id }, { organizationId: null }] }).session(session);
        if (!target) fail('Use an existing manager employee number in this organization', 409);
        const manager = await validateManager(employee._id, String(target._id), company._id, session);
        updates.managerId = manager._id; updates.manager = `${manager.firstName} ${manager.lastName}`.trim();
      }
      await Employee.updateOne({ _id: employee._id }, { $set: updates }, { session, runValidators: true });
    }
    request.status = body.decision; request.reviewNote = note; request.reviewedBy = user._id; request.reviewedAt = new Date();
    await request.save({ session }); reviewed = dto(request);
  });
  return reviewed;
}
module.exports = { list, create, review, companyFor };

const Employee = require('../../auth/models/employee');
const User = require('../../auth/models/usermodel');
const { reviewerRoles } = require('../models/reviewerassignment');
const { fail, objectId } = require('../../organization/services/validation');

async function validateReviewerAssignments(value, participants, template) {
  if (!Array.isArray(value) || value.length > 2000) {
    fail('reviewerAssignments must be an array of at most 2000 entries');
  }
  if (!value.length) return [];

  const participantsById = new Map(participants.map((employee) => [String(employee._id), employee]));
  const enabledRoles = template.frameworkSnapshot.enabledReviewers;
  const assigned = new Set();
  const slots = new Set();
  const externalReviewerIds = new Set();
  const assignments = value.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) ||
        Object.keys(entry).some((key) => !['employeeId', 'reviewerEmployeeId', 'role'].includes(key))) {
      fail('Invalid reviewer assignment fields');
    }
    const employeeId = objectId(entry.employeeId, 'employeeId').toLowerCase();
    const reviewerEmployeeId = objectId(entry.reviewerEmployeeId, 'reviewerEmployeeId').toLowerCase();
    const { role } = entry;
    const employee = participantsById.get(employeeId);
    if (!employee) fail('Reviewer assignments must target a cycle participant');
    if (!reviewerRoles.includes(role) || !enabledRoles.includes(role)) fail('Reviewer role must be enabled by the template');
    if ((role === 'self') !== (employeeId === reviewerEmployeeId)) fail('Only self reviews may be assigned to the participant');
    if (role === 'manager' && String(employee.managerId) !== reviewerEmployeeId) {
      fail('Manager reviews must be assigned to the participant’s manager');
    }

    const pair = `${employeeId}:${reviewerEmployeeId}`;
    const slot = `${employeeId}:${role}`;
    if (assigned.has(pair) || (role !== 'peer' && slots.has(slot))) fail('Duplicate reviewer assignment');
    assigned.add(pair);
    slots.add(slot);
    if (!participantsById.has(reviewerEmployeeId)) externalReviewerIds.add(reviewerEmployeeId);
    return { employeeId, reviewerEmployeeId, role };
  });

  const accountRoles = new Map(participants.map((employee) => [String(employee._id), template.targetRole]));
  if (externalReviewerIds.size) {
    const reviewerIds = [...externalReviewerIds];
    const [employeeCount, accounts] = await Promise.all([
      Employee.countDocuments({
        _id: { $in: reviewerIds },
        $or: [{ organizationId: template.organizationId }, { organizationId: null }],
      }),
      User.find({ employee: { $in: reviewerIds }, status: 'active' }).select('employee role').lean(),
    ]);
    if (employeeCount !== reviewerIds.length || accounts.length !== reviewerIds.length) {
      fail('Every reviewer must belong to the organization and have an active account');
    }
    for (const account of accounts) accountRoles.set(String(account.employee), account.role);
  }
  for (const { role, reviewerEmployeeId } of assignments) {
    const accountRole = accountRoles.get(reviewerEmployeeId);
    if (role === 'peer' && accountRole !== template.targetRole) fail('Peer reviewers must have the same account role as the participant');
    if (role === 'tech_lead' && accountRole !== 'tech_lead') fail('Team Lead reviewers must have the tech_lead role');
  }
  return assignments;
}

module.exports = { validateReviewerAssignments };

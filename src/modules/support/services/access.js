const User = require('../../auth/models/usermodel');
const Membership = require('../models/supportmembership');
const { findActiveUser } = require('../../settings/services/settingsservice');
const { companyFor } = require('../../settings/services/profile-corrections');
const { belongsToCompany } = require('../../organization/services/hierarchyservice');
const { fail } = require('./validation');
async function queuesFor(user, organizationId) {
  if (user.role === 'admin') return ['IT', 'HR'];
  const membership = await Membership.findOne({ user: user._id, organizationId, active: true }).lean();
  return [...new Set([...(user.role === 'hr' ? ['HR'] : []), ...(membership?.queues || [])])];
}
async function actor(authUser) {
  const user = await findActiveUser(authUser);
  const organization = await companyFor(user);
  return { user, organization, queues: await queuesFor(user, organization._id) };
}
function canManage(actor, ticket) { return actor.queues.includes(ticket.queue) && String(ticket.requester) !== String(actor.user._id); }
function authorize(actor, ticket) {
  if (!ticket || String(ticket.organizationId) !== String(actor.organization._id) || (String(ticket.requester) !== String(actor.user._id) && !actor.queues.includes(ticket.queue))) fail('Support request was not found', 404);
}
async function officer(id, organizationId, queue) {
  const user = await User.findById(id).select('email role status employee').populate('employee', 'organizationId').lean();
  if (!user || user.status !== 'active' || (user.employee && !belongsToCompany(user.employee, organizationId)) || !(await queuesFor(user, organizationId)).includes(queue)) fail('Assignee must be an active support officer in this organization and queue');
  return user;
}
module.exports = { actor, queuesFor, canManage, authorize, officer };

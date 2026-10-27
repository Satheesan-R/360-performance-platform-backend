const { randomBytes } = require('crypto');
const Ticket = require('../models/supportticket');
const Membership = require('../models/supportmembership');
const Rate = require('../models/supportrate');
const User = require('../../auth/models/usermodel');
const access = require('./access');
const notifications = require('./notifications');
const { belongsToCompany } = require('../../organization/services/hierarchyservice');
const v = require('./validation');
async function limit(actor, action, maximum) {
  const bucket = Math.floor(Date.now() / 900000);
  const key = v.digest(`${actor.organization._id}:${actor.user._id}:${action}:${bucket}`);
  let record;
  try { record = await Rate.findOneAndUpdate({ _id: key }, { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date((bucket + 2) * 900000) } }, { upsert: true, new: true }); }
  catch (error) { if (error.code !== 11000) throw error; record = await Rate.findOneAndUpdate({ _id: key }, { $inc: { count: 1 } }, { new: true }); }
  if (!record || record.count > maximum) v.fail('Too many support requests. Please try again in 15 minutes', 429);
}
function dto(ticket, actor, detail = true) {
  const own = String(ticket.requester) === String(actor.user._id);
  return { id: String(ticket._id), number: ticket.number, requesterId: String(ticket.requester), category: ticket.category, subject: ticket.subject, queue: ticket.queue, assigneeId: ticket.assignee ? String(ticket.assignee) : null, status: ticket.status, priority: ticket.priority, createdAt: ticket.createdAt, updatedAt: ticket.updatedAt, resolvedAt: ticket.resolvedAt, revision: ticket.revision, notificationStatus: ticket.notificationStatus,
    canManage: access.canManage(actor, ticket), canReopen: own && ticket.status === 'RESOLVED' && Date.now() - new Date(ticket.resolvedAt).getTime() <= 7 * 86400000,
    ...(detail ? { description: ticket.description, messages: (ticket.messages || []).map(item => ({ id: String(item._id), authorType: item.authorType, text: item.text, createdAt: item.createdAt })), history: (ticket.history || []).map(item => ({ action: item.action, from: item.from, to: item.to, note: item.note, assigneeId: item.assignee ? String(item.assignee) : null, createdAt: item.createdAt })) } : {}) };
}
async function context(auth) {
  const actor = await access.actor(auth);
  return { queues: actor.queues, canManageAccess: actor.user.role === 'admin', categories: v.categories.map(id => ({ id, queue: v.route(id) })), reopenDays: 7 };
}
async function create(auth, body) {
  const input = v.createInput(body); const actor = await access.actor(auth);
  const identity = { organizationId: actor.organization._id, requester: actor.user._id, requestId: input.requestId };
  const existing = await Ticket.findOne(identity).lean();
  if (existing) {
    if (existing.category !== input.category || existing.subject !== input.subject || existing.description !== input.description) v.fail('This requestId was already used for different content. Start a new request', 409);
    return { ticket: dto(existing, actor), replayed: true, notification: { status: existing.notificationStatus, message: 'This request was already saved. No duplicate was created.' } };
  }
  await limit(actor, 'create', 5);
  const fingerprint = v.digest(`${actor.organization._id}:${actor.user._id}:${input.category}:${input.subject.toLowerCase()}:${input.description}:${Math.floor(Date.now() / 600000)}`);
  let ticket;
  try {
    ticket = await Ticket.create({ ...identity, ...input, duplicateKey: fingerprint, number: 'SUP-' + randomBytes(8).toString('hex').toUpperCase(), queue: v.route(input.category), history: [{ actor: actor.user._id, action: 'CREATED', to: 'OPEN' }] });
  } catch (error) {
    if (error.code !== 11000) throw error;
    const duplicate = await Ticket.findOne(identity).lean();
    if (duplicate) {
      if (duplicate.category !== input.category || duplicate.subject !== input.subject || duplicate.description !== input.description) v.fail('This requestId was already used for different content', 409);
      return { ticket: dto(duplicate, actor), replayed: true, notification: { status: duplicate.notificationStatus, message: 'This request was already saved.' } };
    }
    v.fail('An identical request was recently submitted. Check My Requests before trying again', 409);
  }
  const notification = await notifications.notify(ticket, 'queue', 'A new account support request is waiting for your queue.');
  ticket.notificationStatus = notification.status;
  return { ticket: dto(ticket, actor), notification, replayed: false };
}
async function list(auth, query = {}) {
  v.fields(query, ['scope', 'queue', 'page']);
  const actor = await access.actor(auth); const filter = { organizationId: actor.organization._id };
  const scope = query.scope || 'mine';
  if (!['mine', 'queue'].includes(scope)) v.fail('Invalid support scope');
  if (scope === 'mine') filter.requester = actor.user._id;
  else {
    if (!actor.queues.length) v.fail('You do not have access to support queues', 403);
    if (query.queue && !actor.queues.includes(query.queue)) v.fail('You do not have access to this support queue', 403);
    filter.queue = query.queue || { $in: actor.queues };
  }
  const page = Number(query.page || 1); if (!Number.isInteger(page) || page < 1 || page > 10000) v.fail('Invalid page');
  const tickets = await Ticket.find(filter).select('-description -messages -history -requestId -duplicateKey').sort({ updatedAt: -1, _id: -1 }).skip((page - 1) * 20).limit(21).lean();
  return { tickets: tickets.slice(0, 20).map(ticket => dto(ticket, actor, false)), page, hasMore: tickets.length > 20 };
}
async function load(auth, id) {
  v.objectId(id); const actor = await access.actor(auth);
  const ticket = await Ticket.findOne({ _id: id, organizationId: actor.organization._id }).lean();
  access.authorize(actor, ticket); return { actor, ticket };
}
async function get(auth, id) { const { actor, ticket } = await load(auth, id); return { ticket: dto(ticket, actor) }; }
async function mutate(auth, id, action, body) {
  const { actor, ticket } = await load(auth, id);
  await limit(actor, 'update', 30);
  if ((ticket.history?.length || 0) >= 300 || (ticket.messages?.length || 0) >= 200) v.fail('This ticket has reached its activity limit. Contact support through a new request', 409);
  const event = { actor: actor.user._id, action, createdAt: new Date() }; const changes = {}; const push = { history: event };
  let audience = 'requester';
  if (action === 'MESSAGE') {
    v.fields(body, ['text']);
    if (['RESOLVED', 'CLOSED'].includes(ticket.status)) v.fail('Reopen an eligible resolved request before replying', 409);
    const own = String(ticket.requester) === String(actor.user._id);
    push.messages = { author: actor.user._id, authorType: own ? 'requester' : 'support', text: v.text(body.text, 'Message', 2, 5000), createdAt: event.createdAt };
    audience = own ? 'queue' : 'requester';
    if (own && ticket.status === 'WAITING_FOR_USER') { changes.status = 'IN_PROGRESS'; event.from = ticket.status; event.to = changes.status; }
  } else if (action === 'REOPENED') {
    v.fields(body, ['note']);
    if (!dto(ticket, actor).canReopen) v.fail('Only the requester can reopen a resolved ticket within seven days', 403);
    changes.status = 'REOPENED'; changes.resolvedAt = null; event.from = ticket.status; event.to = changes.status; event.note = v.text(body.note, 'Reopen reason', 5, 2000); audience = 'queue';
  } else {
    if (!access.canManage(actor, ticket)) v.fail('An authorized support officer must perform this action', 403);
    if (action === 'ASSIGNED') {
      v.fields(body, ['assigneeId', 'priority']);
      if (ticket.status === 'CLOSED') v.fail('Closed requests cannot be assigned', 409);
      if (body.assigneeId !== undefined) { if (body.assigneeId !== null) { v.objectId(body.assigneeId); if (String(body.assigneeId) === String(ticket.requester)) v.fail('The requester cannot be assigned their own request'); await access.officer(body.assigneeId, actor.organization._id, ticket.queue); } changes.assignee = body.assigneeId; event.assignee = body.assigneeId; }
      if (body.priority !== undefined) { if (!['NORMAL', 'HIGH', 'URGENT'].includes(body.priority)) v.fail('Invalid priority'); changes.priority = body.priority; event.note = 'Priority set to ' + body.priority; }
      if (!Object.keys(changes).length) v.fail('Choose an assignee or priority');
    } else {
      v.fields(body, ['status', 'note']);
      if (!(v.transitions[ticket.status] || []).includes(body.status) || body.status === 'REOPENED') v.fail('Invalid support status transition', 409);
      changes.status = body.status; event.from = ticket.status; event.to = body.status;
      if (['RESOLVED', 'CLOSED', 'ESCALATED'].includes(body.status)) event.note = v.text(body.note, 'Resolution or action note', 5, 2000);
      else if (body.note) event.note = v.text(body.note, 'Action note', 2, 2000);
      if (body.status === 'RESOLVED') changes.resolvedAt = event.createdAt;
    }
  }
  const updated = await Ticket.findOneAndUpdate({ _id: ticket._id, organizationId: actor.organization._id, revision: ticket.revision }, { $set: changes, $push: push, $inc: { revision: 1 } }, { new: true, runValidators: true }).lean();
  if (!updated) v.fail('This request changed. Refresh it before trying again', 409);
  const notification = await notifications.notify(updated, audience, action === 'MESSAGE' ? 'Your account support request has a new reply.' : 'An account support request has been updated.');
  updated.notificationStatus = notification.status;
  return { ticket: dto(updated, actor), notification };
}
async function officers(auth, queue) {
  const actor = await access.actor(auth);
  if (!actor.queues.includes(queue)) v.fail('Support queue access required', 403);
  const memberships = await Membership.find({ organizationId: actor.organization._id, active: true, queues: queue }).select('user').lean();
  const users = await User.find({ status: 'active', $or: [{ role: { $in: queue === 'HR' ? ['admin', 'hr'] : ['admin'] } }, { _id: { $in: memberships.map(member => member.user) } }] }).select('email role employee').populate('employee', 'organizationId firstName lastName').limit(100).lean();
  return { officers: users.filter(user => !user.employee || belongsToCompany(user.employee, actor.organization._id)).map(user => ({ id: String(user._id), email: user.email })) };
}
async function membership(auth, body) {
  const actor = await access.actor(auth);
  if (actor.user.role !== 'admin') v.fail('Only admins can manage support access', 403);
  v.fields(body, ['email', 'queues', 'active']);
  if (typeof body.email !== 'string' || body.email.length > 254 || !Array.isArray(body.queues) || body.queues.length > 2 || body.queues.some(queue => !v.queues.includes(queue)) || typeof body.active !== 'boolean') v.fail('Provide an email, valid support queues and active flag');
  const user = await User.findOne({ email: body.email.trim().toLowerCase(), status: 'active' }).select('employee').populate('employee', 'organizationId').lean();
  if (!user || (user.employee && !belongsToCompany(user.employee, actor.organization._id))) v.fail('An active account in this organization is required', 404);
  await limit(actor, 'membership', 20);
  await Membership.findOneAndUpdate({ user: user._id, organizationId: actor.organization._id }, { $set: { queues: [...new Set(body.queues)], active: body.active }, $push: { history: { $each: [{ actor: actor.user._id, queues: body.queues, active: body.active }], $slice: -100 } } }, { upsert: true, runValidators: true });
  return { message: 'Support access updated. Platform roles and HR records were not changed.' };
}
module.exports = { context, create, list, get, mutate, officers, membership, limit, dto };

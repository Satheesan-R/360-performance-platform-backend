const User = require('../../auth/models/usermodel');
const Membership = require('../models/supportmembership');
const Ticket = require('../models/supportticket');
const { belongsToCompany } = require('../../organization/services/hierarchyservice');
const mail = require('../../../services/mailservice');
async function notify(ticket, audience, event) {
  let status = 'unavailable';
  try {
    let users;
    if (audience === 'requester') {
      const user = await User.findById(ticket.requester).select('email status employee').populate('employee', 'organizationId').lean();
      users = user ? [user] : [];
    } else {
      const memberships = await Membership.find({ organizationId: ticket.organizationId, active: true, queues: ticket.queue }).select('user').lean();
      users = await User.find({ status: 'active', $or: [{ role: { $in: ticket.queue === 'HR' ? ['admin', 'hr'] : ['admin'] } }, { _id: { $in: memberships.map(item => item.user) } }] }).select('email status employee').populate('employee', 'organizationId').limit(50).lean();
    }
    const recipients = [...new Set(users.filter(user => user.status === 'active' && (!user.employee || belongsToCompany(user.employee, ticket.organizationId))).map(user => user.email).filter(Boolean))];
    if (recipients.length) status = (await mail.sendSupportNotification(recipients, ticket.number, event)).status;
  } catch { status = 'failed'; }
  // Notification bookkeeping must never turn a committed mutation into an error.
  try { await Ticket.updateOne({ _id: ticket._id }, { $set: { notificationStatus: status } }, { timestamps: false }); } catch { /* Ticket remains saved. */ }
  return { status, message: status === 'accepted' ? 'Notification accepted by the mail server.' : 'Your request was saved. Automatic notifications are unavailable or could not be confirmed; check this page for updates.' };
}
module.exports = { notify };

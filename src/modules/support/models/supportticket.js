const mongoose = require('mongoose');
const { categories, queues, transitions } = require('../services/validation');
const ref = type => ({ type: mongoose.Schema.Types.ObjectId, ref: type });
const message = new mongoose.Schema({ author: ref('User'), authorType: { type: String, enum: ['requester', 'support'] }, text: { type: String, required: true, maxlength: 5000 }, createdAt: { type: Date, default: Date.now } });
const event = new mongoose.Schema({ actor: ref('User'), action: String, from: String, to: String, note: { type: String, maxlength: 2000 }, assignee: ref('User'), createdAt: { type: Date, default: Date.now } });
const schema = new mongoose.Schema({
  number: { type: String, required: true, unique: true },
  requester: { ...ref('User'), required: true }, organizationId: { ...ref('Organization'), required: true },
  requestId: { type: String, required: true }, duplicateKey: { type: String, required: true, unique: true },
  category: { type: String, enum: categories, required: true }, subject: { type: String, maxlength: 160, required: true }, description: { type: String, maxlength: 5000, required: true },
  queue: { type: String, enum: queues, required: true }, assignee: { ...ref('User'), default: null },
  status: { type: String, enum: Object.keys(transitions), default: 'OPEN' }, priority: { type: String, enum: ['NORMAL', 'HIGH', 'URGENT'], default: 'NORMAL' },
  revision: { type: Number, default: 0 }, resolvedAt: { type: Date, default: null },
  messages: [message], history: [event], notificationStatus: { type: String, enum: ['pending', 'accepted', 'failed', 'unavailable'], default: 'pending' },
}, { timestamps: true });
schema.index({ organizationId: 1, requester: 1, requestId: 1 }, { unique: true });
schema.index({ organizationId: 1, requester: 1, createdAt: -1 });
schema.index({ organizationId: 1, queue: 1, updatedAt: -1 });
module.exports = mongoose.model('SupportTicket', schema);

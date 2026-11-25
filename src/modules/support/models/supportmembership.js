const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true },
  queues: [{ type: String, enum: ['IT', 'HR'] }], active: { type: Boolean, default: true },
  history: [{ actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, queues: [String], active: Boolean, createdAt: { type: Date, default: Date.now } }],
}, { timestamps: true });
schema.index({ organizationId: 1, user: 1 }, { unique: true });
module.exports = mongoose.model('SupportMembership', schema);

const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, immutable: true },
  planId: { type: mongoose.Schema.Types.ObjectId, ref: 'GoalPlan', required: true, immutable: true },
  goalId: { type: mongoose.Schema.Types.ObjectId, ref: 'Goal', required: true, immutable: true },
  keyResultId: { type: mongoose.Schema.Types.ObjectId, ref: 'KeyResult', required: true, immutable: true },
  previousValue: { type: Number, required: true, immutable: true },
  value: { type: Number, required: true, immutable: true },
  note: { type: String, default: '', maxlength: 2000, immutable: true },
  sequence: { type: Number, required: true, immutable: true },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
}, { timestamps: { createdAt: true, updatedAt: false }, collection: 'goalCheckIns' });

schema.index({ keyResultId: 1, sequence: 1 }, { unique: true });
module.exports = mongoose.model('GoalCheckIn', schema);

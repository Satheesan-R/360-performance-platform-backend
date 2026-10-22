const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, immutable: true },
  planId: { type: mongoose.Schema.Types.ObjectId, ref: 'GoalPlan', required: true, immutable: true },
  goalId: { type: mongoose.Schema.Types.ObjectId, ref: 'Goal', required: true, immutable: true },
  title: { type: String, required: true, trim: true, maxlength: 200 },
  type: { type: String, enum: ['increase', 'decrease', 'milestone'], required: true },
  unit: { type: String, default: '', maxlength: 40 },
  startValue: { type: Number, required: true },
  targetValue: { type: Number, required: true },
  currentValue: { type: Number, required: true },
  checkInCount: { type: Number, default: 0 },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
}, { timestamps: true, collection: 'keyResults' });

schema.index({ organizationId: 1, goalId: 1, createdAt: 1 });
module.exports = mongoose.model('KeyResult', schema);

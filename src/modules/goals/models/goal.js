const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, immutable: true },
  planId: { type: mongoose.Schema.Types.ObjectId, ref: 'GoalPlan', required: true, immutable: true },
  title: { type: String, required: true, trim: true, maxlength: 200 },
  description: { type: String, default: '', maxlength: 2000 },
  level: { type: String, enum: ['organization', 'team', 'individual'], required: true, immutable: true },
  ownerEmployeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true, immutable: true },
  teamId: { type: mongoose.Schema.Types.ObjectId, ref: 'Team', default: null, immutable: true },
  parentGoalId: { type: mongoose.Schema.Types.ObjectId, ref: 'Goal', default: null, immutable: true },
  status: { type: String, enum: ['draft', 'active', 'completed', 'cancelled'], default: 'draft' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
}, { timestamps: true, collection: 'goals' });

schema.index({ organizationId: 1, planId: 1, level: 1 });
schema.index({ organizationId: 1, ownerEmployeeId: 1, createdAt: -1 });
schema.index({ organizationId: 1, teamId: 1 });
schema.index({ parentGoalId: 1 });
module.exports = mongoose.model('Goal', schema);

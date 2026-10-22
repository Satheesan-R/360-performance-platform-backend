const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, immutable: true },
  name: { type: String, required: true, trim: true, maxlength: 200 },
  description: { type: String, default: '', maxlength: 2000 },
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  status: { type: String, enum: ['draft', 'active', 'closed', 'archived'], default: 'draft' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  // All writes within a plan acquire this lock in a transaction, including closure.
  writeVersion: { type: Number, default: 0, select: false },
}, { timestamps: true, collection: 'goalPlans' });

schema.index({ organizationId: 1, status: 1, startDate: -1 });
module.exports = mongoose.model('GoalPlan', schema);

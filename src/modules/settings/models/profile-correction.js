const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  requester: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true, immutable: true },
  organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, immutable: true, index: true },
  field: { type: String, enum: ['jobTitle', 'department', 'reportingManager'], required: true, immutable: true },
  currentValue: { type: String, maxlength: 120, default: '', immutable: true },
  proposedValue: { type: String, required: true, maxlength: 120, immutable: true },
  reason: { type: String, required: true, maxlength: 500, immutable: true },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  reviewedAt: Date,
  reviewNote: { type: String, maxlength: 500, default: '' },
}, { timestamps: true });
schema.index({ requester: 1, field: 1 }, { unique: true, partialFilterExpression: { status: 'pending' } });
module.exports = mongoose.model('ProfileCorrection', schema);

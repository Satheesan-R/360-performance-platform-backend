const mongoose = require('mongoose');

const teamSchema = new mongoose.Schema({
  organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, immutable: true, index: true },
  name: { type: String, required: true, trim: true },
  code: { type: String, required: true, trim: true, uppercase: true },
  departmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', required: true, index: true },
  teamLeadEmployeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null },
  description: { type: String, trim: true },
  status: { type: String, enum: ['active', 'inactive'], default: 'active' },
}, { timestamps: true, collection: 'teams' });

teamSchema.index({ organizationId: 1, code: 1 }, { unique: true });

module.exports = mongoose.model('Team', teamSchema);

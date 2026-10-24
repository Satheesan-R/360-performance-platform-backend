const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, immutable: true },
  name: { type: String, required: true, trim: true, maxlength: 200 },
  templateId: { type: mongoose.Schema.Types.ObjectId, ref: 'ReviewTemplate', required: true, immutable: true },
  templateSnapshotId: { type: mongoose.Schema.Types.ObjectId, ref: 'ReviewTemplateSnapshot', required: true, immutable: true },
  templateVersion: { type: Number, required: true, immutable: true },
  targetRole: { type: String, enum: ['department_manager'], default: 'department_manager', immutable: true },
  departmentIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Department' }],
  employeeIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Employee' }],
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  status: { type: String, enum: ['draft'], default: 'draft' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
}, { timestamps: true, collection: 'reviewCycles' });

schema.index({ organizationId: 1, createdAt: -1 });
module.exports = mongoose.model('ReviewCycle', schema);

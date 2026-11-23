const mongoose = require('mongoose');
const { reviewerAssignmentSchema } = require('./reviewerassignment');

const schema = new mongoose.Schema({
  organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, immutable: true },
  name: { type: String, required: true, trim: true, maxlength: 200 },
  templateId: { type: mongoose.Schema.Types.ObjectId, ref: 'ReviewTemplate', required: true },
  templateSnapshotId: { type: mongoose.Schema.Types.ObjectId, ref: 'ReviewTemplateSnapshot', default: null },
  templateVersion: { type: Number, default: null },
  targetRole: { type: String, enum: ['employee', 'tech_lead', 'department_manager'], default: 'department_manager' },
  departmentIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Department' }],
  employeeIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Employee' }],
  reviewerAssignments: { type: [reviewerAssignmentSchema], default: [] },
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  status: { type: String, enum: ['draft', 'published'], default: 'draft' },
  publishedAt: { type: Date, default: null },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
}, { timestamps: true, collection: 'reviewCycles' });

schema.index({ organizationId: 1, createdAt: -1 });
schema.index({ organizationId: 1, status: 1, 'reviewerAssignments.reviewerEmployeeId': 1, publishedAt: -1 });
module.exports = mongoose.model('ReviewCycle', schema);

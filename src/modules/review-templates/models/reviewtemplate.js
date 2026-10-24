const mongoose = require('mongoose');

const questionSchema = new mongoose.Schema({
  prompt: { type: String, required: true, trim: true, maxlength: 2000 },
  required: { type: Boolean, default: false },
});
const sectionSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 200 },
  competencyIds: [{ type: mongoose.Schema.Types.ObjectId }],
  kpiIds: [{ type: mongoose.Schema.Types.ObjectId }],
  questions: { type: [questionSchema], default: [] },
  required: { type: Boolean, default: false },
  allowComments: { type: Boolean, default: true },
  commentsRequired: { type: Boolean, default: false },
  evidenceRequired: { type: Boolean, default: false },
});
const templateSchema = new mongoose.Schema({
  organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, immutable: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 200 },
  description: { type: String, trim: true, maxlength: 2000, default: '' },
  reviewType: { type: String, enum: ['annual', 'probation', 'internship'], default: 'annual' },
  departmentIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Department' }],
  targetRole: { type: String, enum: ['department_manager'], default: 'department_manager' },
  frameworkId: { type: mongoose.Schema.Types.ObjectId, ref: 'PerformanceFramework', required: true, index: true },
  employmentTypeIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'EmploymentType' }],
  sections: { type: [sectionSchema], default: [] },
  evidenceRequired: { type: Boolean, default: false },
  status: { type: String, enum: ['draft', 'active', 'archived'], default: 'draft' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  approvalStatus: { type: String, enum: ['not_submitted', 'pending', 'approved', 'rejected'], default: 'not_submitted' },
  submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  submittedAt: { type: Date, default: null },
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  approvedAt: { type: Date, default: null },
  approvalComment: { type: String, default: '', maxlength: 1000 },
  frameworkVersion: { type: Number, default: null },
  frameworkSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
}, { timestamps: true, collection: 'reviewTemplates' });
templateSchema.index({ organizationId: 1, status: 1 });

module.exports = mongoose.model('ReviewTemplate', templateSchema);

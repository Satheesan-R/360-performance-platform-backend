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
  frameworkId: { type: mongoose.Schema.Types.ObjectId, ref: 'PerformanceFramework', required: true, index: true },
  employmentTypeIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'EmploymentType' }],
  sections: { type: [sectionSchema], default: [] },
  evidenceRequired: { type: Boolean, default: false },
  status: { type: String, enum: ['draft', 'active', 'archived'], default: 'draft' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  frameworkVersion: { type: Number, default: null },
  frameworkSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
}, { timestamps: true, collection: 'reviewTemplates' });
templateSchema.index({ organizationId: 1, status: 1 });

module.exports = mongoose.model('ReviewTemplate', templateSchema);

const mongoose = require('mongoose');
const { competencySchema, kpiSchema } = require('./criteria');
const { ratingScaleSchema, categoryWeightsSchema, reviewerWeightsSchema } = require('./scoring');

const performanceFrameworkSchema = new mongoose.Schema({
  organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, immutable: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 200 },
  description: { type: String, trim: true, maxlength: 2000, default: '' },
  applicableEmploymentTypeIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'EmploymentType' }],
  // Job titles are separate from login/access roles such as HR or admin.
  applicableJobRoles: [{ type: String, trim: true, maxlength: 200 }],
  competencies: { type: [competencySchema], default: [] },
  kpis: { type: [kpiSchema], default: [] },
  ratingScale: { type: ratingScaleSchema, default: null },
  categoryWeights: { type: categoryWeightsSchema, default: null },
  reviewerWeights: { type: reviewerWeightsSchema, default: null },
  enabledReviewers: { type: [{ type: String, enum: ['self', 'peer', 'manager'] }], default: [] },
  status: { type: String, enum: ['draft', 'active', 'archived'], default: 'draft' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
}, { timestamps: true, collection: 'performanceFrameworks' });

performanceFrameworkSchema.index({ organizationId: 1, status: 1 });

module.exports = mongoose.model('PerformanceFramework', performanceFrameworkSchema);

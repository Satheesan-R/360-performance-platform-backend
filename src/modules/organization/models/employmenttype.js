const mongoose = require('mongoose');

const employmentTypeSchema = new mongoose.Schema({
  organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, immutable: true, index: true },
  name: { type: String, required: true, trim: true },
  code: { type: String, required: true, trim: true, uppercase: true },
  description: { type: String, trim: true },
  isActive: { type: Boolean, default: true },
}, { timestamps: true, collection: 'employmentTypes' });

employmentTypeSchema.index({ organizationId: 1, code: 1 }, { unique: true });

module.exports = mongoose.model('EmploymentType', employmentTypeSchema);

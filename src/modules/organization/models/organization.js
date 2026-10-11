const mongoose = require('mongoose');

const organizationSchema = new mongoose.Schema({
  singletonKey: { type: String, default: 'company', enum: ['company'], unique: true, immutable: true },
  hierarchyVersion: { type: Number, default: 0, select: false },
  name: { type: String, required: true, trim: true },
  code: { type: String, required: true, trim: true, uppercase: true },
  logoUrl: { type: String, trim: true },
  industry: { type: String, trim: true },
  description: { type: String, trim: true },
  contactEmail: { type: String, trim: true, lowercase: true },
  country: { type: String, trim: true },
  timezone: { type: String, trim: true },
  status: { type: String, enum: ['active', 'inactive'], default: 'active' },
}, { timestamps: true });

module.exports = mongoose.model('Organization', organizationSchema);

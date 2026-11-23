const mongoose = require('mongoose');

const snapshotSchema = new mongoose.Schema({
  organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, immutable: true },
  frameworkId: { type: mongoose.Schema.Types.ObjectId, ref: 'PerformanceFramework', required: true, immutable: true },
  sourceVersion: { type: Number, required: true, immutable: true },
  configuration: { type: mongoose.Schema.Types.Mixed, required: true, immutable: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  createdAt: { type: Date, default: Date.now, immutable: true },
}, { collection: 'performanceFrameworkSnapshots', versionKey: false });

snapshotSchema.index({ organizationId: 1, frameworkId: 1, sourceVersion: 1 }, { unique: true });
module.exports = mongoose.model('PerformanceFrameworkSnapshot', snapshotSchema);

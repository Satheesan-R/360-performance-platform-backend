const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  organizationId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
  templateId: { type: mongoose.Schema.Types.ObjectId, ref: 'ReviewTemplate', required: true, immutable: true },
  sourceVersion: { type: Number, required: true, immutable: true },
  configuration: { type: mongoose.Schema.Types.Mixed, required: true, immutable: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  createdAt: { type: Date, default: Date.now, immutable: true },
}, { collection: 'reviewTemplateSnapshots', versionKey: false });
schema.index({ organizationId: 1, templateId: 1, sourceVersion: 1 }, { unique: true });
module.exports = mongoose.model('ReviewTemplateSnapshot', schema);

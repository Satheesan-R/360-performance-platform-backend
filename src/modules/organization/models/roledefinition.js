const mongoose = require('mongoose');

const roleDefinitionSchema = new mongoose.Schema({
  organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, immutable: true, index: true },
  code: { type: String, required: true, trim: true, uppercase: true },
  label: { type: String, required: true, trim: true },
  permissions: {
    type: [{ type: String, trim: true, match: /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/ }],
    default: [],
    validate: { validator: (values) => new Set(values).size === values.length, message: 'Permissions must not contain duplicates' },
  },
  isSystemRole: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true },
}, { timestamps: true, collection: 'roleDefinitions' });

roleDefinitionSchema.index({ organizationId: 1, code: 1 }, { unique: true });

module.exports = mongoose.model('RoleDefinition', roleDefinitionSchema);

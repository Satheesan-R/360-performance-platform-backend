const mongoose = require('mongoose');

const departmentSchema = new mongoose.Schema({
  organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, immutable: true, index: true },
  name: { type: String, required: true, trim: true },
  code: { type: String, required: true, trim: true, uppercase: true, unique: true },
  description: { type: String, trim: true },
  headEmployeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null },
  status: { type: String, enum: ['active', 'inactive'], default: 'active' },
}, { timestamps: true });

module.exports = mongoose.model('Department', departmentSchema);

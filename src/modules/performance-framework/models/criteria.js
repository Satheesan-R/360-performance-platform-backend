const mongoose = require('mongoose');

const common = {
  name: { type: String, required: true, trim: true, maxlength: 200 },
  description: { type: String, trim: true, maxlength: 2000, default: '' },
  weight: { type: Number, required: true, min: 0, max: 100 },
  status: { type: String, enum: ['active', 'inactive'], default: 'active' },
};

const competencySchema = new mongoose.Schema({
  ...common,
  category: { type: String, enum: ['technical', 'behavioral'], required: true },
}, { timestamps: true });

const kpiSchema = new mongoose.Schema({
  ...common,
  measurementUnit: { type: String, required: true, trim: true, maxlength: 200 },
  targetValue: { type: Number, required: true },
  targetPeriod: { type: String, trim: true, maxlength: 200, default: '' },
}, { timestamps: true });

module.exports = { competencySchema, kpiSchema };

const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  cycleId: { type: mongoose.Schema.Types.ObjectId, ref: 'ReviewCycle', required: true },
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  reviewerEmployeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  sections: { type: [mongoose.Schema.Types.Mixed], default: [] },
  version: { type: Number, required: true, default: 0 },
  submittedAt: { type: Date, default: null },
}, { timestamps: true, versionKey: false, collection: 'reviewResponses' });

schema.index({ cycleId: 1, employeeId: 1, reviewerEmployeeId: 1 }, { unique: true });
module.exports = mongoose.model('ReviewResponse', schema);

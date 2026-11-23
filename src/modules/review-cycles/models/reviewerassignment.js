const mongoose = require('mongoose');

const reviewerRoles = ['self', 'peer', 'tech_lead', 'manager'];
const reviewerAssignmentSchema = new mongoose.Schema({
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  reviewerEmployeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  role: { type: String, enum: reviewerRoles, required: true },
}, { _id: false });

module.exports = { reviewerRoles, reviewerAssignmentSchema };

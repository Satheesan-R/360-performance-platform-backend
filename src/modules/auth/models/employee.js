const mongoose = require('mongoose');

const employeeSchema = new mongoose.Schema(
  {
    employeeNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    workEmail: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    personalEmail: {
      type: String,
      lowercase: true,
      trim: true,
      sparse: true,
    },
    phone: { type: String, trim: true },
    address: { type: String, trim: true },
    university: { type: String, trim: true },
    previousCompany: { type: String, trim: true },
    previousJobTitle: { type: String, trim: true },
    yearsOfExperience: { type: String, trim: true },
    jobTitle: { type: String, trim: true },
    department: { type: String, trim: true },
    JoiningDate: Date,
    probationPeriod: { type: String, trim: true },
    manager: { type: String, trim: true },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      unique: true,
      sparse: true,
    },
    onboardingStatus: {
      type: String,
      enum: ['pending', 'completed'],
      default: 'completed',
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Employee', employeeSchema);
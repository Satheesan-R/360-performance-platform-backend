const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee',
      unique: true,
      sparse: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    passwordHash: {
      type: String,
      select: false,
    },
    role: {
      type: String,
      enum: ['employee', 'tech_lead', 'department_manager', 'hr', 'admin'],
      default: 'employee',
      required: true,
    },
    status: {
      type: String,
      enum: ['invited', 'otp_verified', 'active', 'disabled'],
      default: 'invited',
      required: true,
    },
    profileDetails: { type: require('../../settings/models/profile-details-schema'), default: () => ({}) },
    lastLoginAt: Date,
    passwordChangedAt: Date,
    sessionVersion: { type: Number, default: 0 },
    preferences: {
      language: { type: String, enum: ['en'], default: 'en' },
      timezone: { type: String, default: 'UTC' },
      landingPage: { type: String, default: '' },
      theme: { type: String, enum: ['light', 'dark', 'system'], default: 'system' },
      appearance: {
        accent: { type: String, enum: ['blue', 'teal', 'violet'], default: 'blue' },
        fontSize: { type: Number, min: 14, max: 18, validate: Number.isInteger, default: 16 },
        reduceMotion: { type: String, enum: ['system', 'on', 'off'], default: 'system' },
        contrast: { type: String, enum: ['standard', 'high'], default: 'standard' },
      },
      notifications: {
        email: { type: Boolean, default: true }, goals: { type: Boolean, default: true },
        reviews: { type: Boolean, default: true }, feedback: { type: Boolean, default: true },
        development: { type: Boolean, default: true },
      },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('User', userSchema);

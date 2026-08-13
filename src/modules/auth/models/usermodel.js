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
      enum: ['employee', 'manager', 'hr', 'admin'],
      default: 'employee',
      required: true,
    },
    status: {
      type: String,
      enum: ['invited', 'otp_verified', 'active', 'disabled'],
      default: 'invited',
      required: true,
    },
    lastLoginAt: Date,
  },
  { timestamps: true }
);

module.exports = mongoose.model('User', userSchema);
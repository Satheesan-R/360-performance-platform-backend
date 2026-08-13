const mongoose = require('mongoose');

const activationSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  tokenHash: { type: String, required: true, unique: true },
  otpHash: { type: String, select: false },
  otpExpiresAt: Date,
  otpAttempts: { type: Number, default: 0 },
  expiresAt: { type: Date, required: true, expires: 0 },
});

module.exports = mongoose.model('AccountActivation', activationSchema);

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/usermodel');
const AccountActivation = require('../models/account-activation');
const Employee = require('../models/employee');
const { sendOtpEmail } = require('../../../services/mailservice');
const { env } = require('../../../config/env');

const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');

async function findActivation(token, includeOtp = false) {
  if (!token) throw new Error('Activation token is required');
  let query = AccountActivation.findOne({ tokenHash: hash(token), expiresAt: { $gt: new Date() } });
  if (includeOtp) query = query.select('+otpHash');
  const activation = await query;
  if (!activation) throw new Error('Activation link is invalid or expired');
  return activation;
}

async function login(email, password) {
  const user = await User.findOne({ email: email?.toLowerCase().trim() }).select('+passwordHash');
  if (!user || !user.passwordHash || !(await bcrypt.compare(password || '', user.passwordHash))) {
    throw new Error('Invalid email or password');
  }
  if (user.status !== 'active') throw new Error('Please activate your account first');
  user.lastLoginAt = new Date();
  await user.save();
  const token = jwt.sign({ id: user._id, role: user.role, sessionVersion: user.sessionVersion || 0 }, env.jwtSecret, { expiresIn: env.jwtExpiresIn });
  return { token, user };
}

async function sendActivationOtp(token) {
  const activation = await findActivation(token);
  const user = await User.findById(activation.user);
  if (!user || user.status === 'active') throw new Error('Account is already active or unavailable');

  const otp = crypto.randomInt(100000, 1000000).toString();
  activation.otpHash = hash(otp);
  activation.otpExpiresAt = new Date(Date.now() + 2 * 60 * 1000);
  activation.otpAttempts = 0;
  await activation.save();
  await sendOtpEmail(user.email, otp);
  return user.email.replace(/^(.{2}).*(@.*)$/, '$1***$2');
}

async function verifyActivationOtp(token, otp) {
  const activation = await findActivation(token, true);
  if (!activation.otpHash || activation.otpExpiresAt <= new Date()) throw new Error('OTP is expired. Request a new OTP');
  if (activation.otpAttempts >= 5) throw new Error('Too many incorrect attempts. Request a new OTP');
  if (hash(String(otp)) !== activation.otpHash) {
    activation.otpAttempts += 1;
    await activation.save();
    throw new Error('Incorrect OTP');
  }

  const user = await User.findById(activation.user);
  user.status = 'otp_verified';
  await user.save();
  return jwt.sign({ id: user._id, activationId: activation._id, purpose: 'password_setup' }, env.jwtSecret, { expiresIn: '15m' });
}

async function createPassword(setupToken, password) {
  if (!password || password.length < 8) throw new Error('Password must contain at least 8 characters');
  let payload;
  try { payload = jwt.verify(setupToken, env.jwtSecret); } catch { throw new Error('Password setup session is invalid or expired'); }
  if (payload.purpose !== 'password_setup') throw new Error('Invalid password setup session');

  const activation = await AccountActivation.findOne({ _id: payload.activationId, user: payload.id });
  const user = await User.findById(payload.id).select('+passwordHash');
  if (!activation || !user || user.status !== 'otp_verified') throw new Error('Verify your OTP before creating a password');

  user.passwordHash = await bcrypt.hash(password, 10);
  user.status = 'active';
  await user.save();
  await Employee.updateOne(
    { _id: user.employee, onboardingStatus: 'pending' },
    { $set: { onboardingStatus: 'completed' } }
  );
  await AccountActivation.deleteOne({ _id: activation._id });
  return user;
}

module.exports = { login, sendActivationOtp, verifyActivationOtp, createPassword };

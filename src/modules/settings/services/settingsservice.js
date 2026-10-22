const User = require('../../auth/models/usermodel');
const Employee = require('../../auth/models/employee');
const bcrypt = require('bcryptjs');

const EDITABLE_FIELDS = ['phone', 'address'];

function fail(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  throw error;
}

async function findActiveUser(authUser) {
  if (!authUser || authUser.purpose || !authUser.id || !authUser.role) fail('Login required', 401);

  const user = await User.findById(authUser.id)
    .select('email role status lastLoginAt employee')
    .populate('employee', 'employeeNumber firstName lastName workEmail phone address jobTitle department officeLocation')
    .lean();

  if (!user || user.status !== 'active') fail('Account unavailable', 401);
  return user;
}

async function getProfile(authUser) {
  const user = await findActiveUser(authUser);
  return {
    id: user._id,
    email: user.email,
    role: user.role,
    lastLoginAt: user.lastLoginAt || null,
    employee: user.employee || null,
  };
}

function validateProfileUpdate(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('A JSON object is required');
  const keys = Object.keys(body);
  if (!keys.length) fail('Nothing to update');
  const unknown = keys.filter((key) => !EDITABLE_FIELDS.includes(key));
  if (unknown.length) fail(`Unknown fields: ${unknown.join(', ')}`);

  const updates = {};
  for (const key of keys) {
    if (typeof body[key] !== 'string') fail(`${key} must be text`);
    updates[key] = body[key].trim();
  }
  if (updates.phone && !/^[0-9+\-\s()]{7,20}$/.test(updates.phone)) fail('phone must be a valid phone number');
  if (updates.address && updates.address.length > 300) fail('address is too long');
  return updates;
}

async function updateProfile(authUser, body) {
  const updates = validateProfileUpdate(body);
  const user = await findActiveUser(authUser);
  if (!user.employee) fail('No employee profile linked to this account', 404);

  await Employee.updateOne({ _id: user.employee._id }, { $set: updates }, { runValidators: true });
  return getProfile(authUser);
}

async function changePassword(authUser, body) {
  if (!authUser || authUser.purpose || !authUser.id || !authUser.role) fail('Login required', 401);
  const { currentPassword, newPassword } = body || {};
  if (typeof currentPassword !== 'string' || !currentPassword) fail('currentPassword is required');
  if (typeof newPassword !== 'string' || newPassword.length < 8) fail('newPassword must contain at least 8 characters');
  if (newPassword.length > 72) fail('newPassword is too long');
  if (newPassword === currentPassword) fail('newPassword must be different from currentPassword');

  const user = await User.findById(authUser.id).select('+passwordHash status');
  if (!user || user.status !== 'active') fail('Account unavailable', 401);
  if (!user.passwordHash || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
    fail('Current password is incorrect');
  }

  user.passwordHash = await bcrypt.hash(newPassword, 10);
  await user.save();
}

module.exports = { getProfile, updateProfile, changePassword };
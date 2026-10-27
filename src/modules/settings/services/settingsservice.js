const User = require('../../auth/models/usermodel');
const Employee = require('../../auth/models/employee');
const bcrypt = require('bcryptjs');
const preferences = require('./preferences');
const { fail, fields } = preferences;
const profileDetails = require('./profile-details');
const mail = require('../../../services/mailservice');

async function findActiveUser(authUser) {
  if (!authUser || authUser.purpose || !/^[a-f\d]{24}$/i.test(String(authUser.id || '')) || !preferences.LANDING_PAGES[authUser.role]) fail('Login required', 401);
  const user = await User.findById(authUser.id)
    .select('email role status lastLoginAt passwordChangedAt employee preferences profileDetails +passwordHash')
    .populate({ path: 'employee', select: 'organizationId employeeNumber firstName lastName workEmail phone address jobTitle department departmentId teamId managerId manager', populate: [
      { path: 'departmentId', select: 'name' }, { path: 'teamId', select: 'name' }, { path: 'managerId', select: 'firstName lastName' },
    ] }).lean();
  if (!user || user.status !== 'active' || user.role !== authUser.role) fail('Account unavailable or permissions changed. Please sign in again', 401);
  return user;
}
function profileDto(user) {
  const employee = user.employee;
  return {
    id: String(user._id), email: user.email, role: user.role, status: user.status,
    details: profileDetails.read(user.profileDetails),
    lastLoginAt: user.lastLoginAt || null, passwordChangedAt: user.passwordChangedAt || null,
    capabilities: { extendedProfile: true, corrections: Boolean(employee), correctionReview: ['hr', 'admin'].includes(user.role), editableProfileFields: employee ? ['phone', 'address'] : [], passwordChange: Boolean(user.passwordHash), authMethod: user.passwordHash ? 'password' : 'managed', mfa: false, sessions: false },
    employee: employee ? {
      _id: String(employee._id), employeeNumber: employee.employeeNumber, firstName: employee.firstName, lastName: employee.lastName,
      workEmail: employee.workEmail, phone: employee.phone || '', address: employee.address || '', jobTitle: employee.jobTitle || '',
      department: employee.departmentId?.name || employee.department || '', team: employee.teamId?.name || '',
      reportingManager: employee.managerId ? [employee.managerId.firstName, employee.managerId.lastName].filter(Boolean).join(' ') : employee.manager || '',
    } : null,
  };
}
async function getProfile(authUser) { return profileDto(await findActiveUser(authUser)); }
async function updateProfile(authUser, body) {
  fields(body, ['phone', 'address', 'details']);
  if ('details' in body) {
    if (Object.keys(body).length !== 1) fail('Save professional details separately from contact fields');
    const details = profileDetails.validate(body.details);
    const user = await findActiveUser(authUser);
    const result = await User.updateOne({ _id: user._id, status: 'active', role: user.role }, { $set: { profileDetails: details } }, { runValidators: true });
    if (result.matchedCount === 0) fail('Your account changed during this request. Sign in and try again', 409);
    return getProfile(authUser);
  }
  if (!Object.keys(body).length) fail('Nothing to update');
  const updates = {};
  for (const [key, value] of Object.entries(body)) { if (typeof value !== 'string') fail(`${key} must be text`); updates[key] = value.trim(); }
  if (updates.phone && (!/^\+?[0-9\-\s()]{7,20}$/.test(updates.phone) || updates.phone.replace(/\D/g, '').length < 7 || updates.phone.replace(/\D/g, '').length > 15)) fail('phone must contain 7–15 digits');
  if (updates.address && updates.address.length > 300) fail('address is too long');
  const user = await findActiveUser(authUser);
  if (!user.employee) fail('No employee profile linked to this account', 404);
  await Employee.updateOne({ _id: user.employee._id }, { $set: updates }, { runValidators: true });
  return getProfile(authUser);
}
async function getPreferences(authUser) { const user = await findActiveUser(authUser); return preferences.read(user.preferences, user.role); }
async function updatePreferences(authUser, body) {
  const user = await findActiveUser(authUser);
  const next = preferences.validate(body, user.role, preferences.read(user.preferences, user.role));
  const result = await User.updateOne({ _id: user._id, status: 'active', role: user.role }, { $set: { preferences: next } }, { runValidators: true });
  if (result.matchedCount === 0) fail('Your account changed during this request. Sign in and try again', 409);
  return next;
}
async function changePassword(authUser, body) {
  fields(body, ['currentPassword', 'newPassword']);
  const { currentPassword, newPassword } = body;
  if (typeof currentPassword !== 'string' || !currentPassword) fail('currentPassword is required');
  if (typeof newPassword !== 'string' || newPassword.length < 8) fail('newPassword must contain at least 8 characters');
  if (Buffer.byteLength(newPassword, 'utf8') > 72) fail('newPassword must not exceed 72 UTF-8 bytes');
  if (newPassword === currentPassword) fail('newPassword must be different from currentPassword');
  const active = await findActiveUser(authUser);
  if (!active.passwordHash) fail('Password is managed by your identity provider. Contact IT to change it', 403);
  if (!(await bcrypt.compare(currentPassword, active.passwordHash))) fail('Current password is incorrect');
  const passwordHash = await bcrypt.hash(newPassword, 10);
  const changedAt = new Date();
  const result = await User.updateOne({ _id: active._id, status: 'active', passwordHash: active.passwordHash }, {
    $set: { passwordHash, passwordChangedAt: changedAt }, $inc: { sessionVersion: 1 },
  });
  if (result.matchedCount === 0) fail('Your account changed during this request. Sign in and try again', 409);
  // A mail failure must not disguise an already committed password change.
  let notification;
  try { notification = await mail.sendPasswordChangedEmail(active.email, changedAt); }
  catch { notification = { status: 'failed' }; }
  return { requiresLogin: true, notification };
}
module.exports = { findActiveUser, profileDto, getProfile, updateProfile, changePassword, getPreferences, updatePreferences };

const bcrypt = require('bcryptjs');
const User = require('../models/usermodel');

function validateAdminCredentials(email, password) {
  if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
    throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD before running this command');
  }
  const normalizedEmail = email.toLowerCase().trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) throw new Error('ADMIN_EMAIL must be a valid email address');
  if (password.length < 12 || !password.trim()) throw new Error('ADMIN_PASSWORD must contain at least 12 characters');
  // bcrypt uses only the first 72 bytes; reject passwords it would truncate.
  if (Buffer.byteLength(password, 'utf8') > 72) throw new Error('ADMIN_PASSWORD must not exceed 72 UTF-8 bytes');
  return { email: normalizedEmail, password };
}

async function createAdmin(email, password) {
  const credentials = validateAdminCredentials(email, password);
  if (await User.exists({ email: credentials.email })) {
    throw new Error('An account with this email already exists; no account was changed');
  }
  let admin;
  try {
    admin = await User.create({ email: credentials.email, passwordHash: await bcrypt.hash(credentials.password, 12), role: 'admin', status: 'active' });
  } catch (error) {
    if (error.code === 11000) throw new Error('An account with this email already exists; no account was changed');
    throw error;
  }
  return { id: admin._id, email: admin.email, role: admin.role, status: admin.status };
}

module.exports = { createAdmin, validateAdminCredentials };

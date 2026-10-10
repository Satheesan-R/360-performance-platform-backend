const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const connectDatabase = require('../src/config/db');
const { validateEnv } = require('../src/config/env');
const User = require('../src/modules/auth/models/usermodel');

async function createHr() {
  validateEnv();
  const email = process.env.HR_EMAIL?.toLowerCase().trim();
  const password = process.env.HR_PASSWORD;

  if (!email || !password) {
    throw new Error('Set HR_EMAIL and HR_PASSWORD before running this command');
  }
  if (password.length < 8) {
    throw new Error('HR_PASSWORD must contain at least 8 characters');
  }

  await connectDatabase();
  if (await User.exists({ email })) {
    throw new Error('An account already exists for ' + email);
  }

  const hr = await User.create({
    email,
    passwordHash: await bcrypt.hash(password, 12),
    role: 'hr',
    status: 'active',
  });
  console.log('HR account created successfully: ' + hr.email);
}

createHr()
  .catch((error) => {
    console.error('Could not create HR account:', error.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());

const mongoose = require('mongoose');
const connectDatabase = require('../src/config/db');
const { validateEnv } = require('../src/config/env');
const { createAdmin, validateAdminCredentials } = require('../src/modules/auth/services/provisionadmin');

async function run() {
  validateEnv();
  const { email, password } = validateAdminCredentials(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);
  await connectDatabase();
  const admin = await createAdmin(email, password);
  console.log('Admin account created successfully: ' + admin.email);
}

if (require.main === module) {
  run().catch((error) => {
    console.error('Could not create admin account:', error.message);
    process.exitCode = 1;
  }).finally(() => mongoose.disconnect());
}

module.exports = { run };

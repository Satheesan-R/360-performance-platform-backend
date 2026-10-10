const mongoose = require('mongoose');
const { env, validateEnv } = require('../src/config/env');
const Organization = require('../src/modules/organization/models/organization');
const Department = require('../src/modules/organization/models/department');

async function linkDepartments(apply = false) {
  const organization = await Organization.findOne({ singletonKey: 'company' }).lean();
  if (!organization) throw new Error('Set up the organization through PATCH /api/organization first');
  const filter = { organizationId: null };
  const count = await Department.countDocuments(filter);
  console.log(`${count} departments need an organization link.`);
  if (!apply) {
    console.log('Dry run only. Use npm run departments:link -- --apply to save the links.');
    return;
  }
  // Existing records predate this immutable field; only fill absent links.
  const result = await Department.updateMany(filter, { $set: { organizationId: organization._id } }, { overwriteImmutable: true });
  console.log(`Linked ${result.modifiedCount} departments to ${organization.name}.`);
}

async function run() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--apply') || args.length > 1) throw new Error('Usage: npm run departments:link -- [--apply]');
  validateEnv();
  await mongoose.connect(env.mongoUri);
  await linkDepartments(args.includes('--apply'));
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  }).finally(() => mongoose.disconnect());
}

module.exports = { linkDepartments };

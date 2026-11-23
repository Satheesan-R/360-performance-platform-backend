const mongoose = require('mongoose');
const connectDatabase = require('../src/config/db');
const Employee = require('../src/modules/auth/models/employee');
const { listEmployees } = require('../src/modules/employees/services/employeeservice');

const onboardingFields = [
  'designation',
  'departmentName',
  'reportingManagerName',
  'employmentTypeName',
  'contractStartDate',
];

async function main() {
  await connectDatabase();
  let valuesAdded = 0;
  for (const employee of await listEmployees()) {
    for (const field of onboardingFields) {
      if (employee[field] == null) continue;
      const result = await Employee.updateOne(
        { _id: employee._id, [field]: { $exists: false }, updatedAt: employee.updatedAt },
        { $set: { [field]: employee[field] } },
        { timestamps: false }
      );
      valuesAdded += result.modifiedCount;
    }
  }
  console.log(`Added ${valuesAdded} missing onboarding field values`);
}

main().catch((error) => {
  console.error(`Employee onboarding backfill failed: ${error.message}`);
  process.exitCode = 1;
}).finally(() => mongoose.disconnect());

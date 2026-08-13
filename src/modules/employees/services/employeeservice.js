const crypto = require('crypto');
const Employee = require('../../auth/models/employee');
const User = require('../../auth/models/usermodel');
const AccountActivation = require('../../auth/models/account-activation');
const { sendActivationEmail } = require('../../../services/mailservice');
const { env } = require('../../../config/env');

async function createEmployee(data) {
  const email = data.companyEmail?.toLowerCase().trim();
  if (!data.fullName || !email) {
    throw new Error('Full name and company email are required');
  }

  if (await User.exists({ email })) throw new Error('A user with this email already exists');

  const names = data.fullName.trim().split(/\s+/);
  const employee = await Employee.create({
    employeeNumber: data.employeeNumber || 'EMP-' + Date.now(),
    firstName: names.shift(),
    lastName: names.join(' ') || '-',
    workEmail: email,
    personalEmail: data.personalEmail,
    phone: data.phone,
    jobTitle: data.designation,
    department: data.department,
    manager: data.reportingManager,
    JoiningDate: data.contractStartDate,
    employmentType: data.employmentType,
    officeLocation: data.officeLocation,
    gender: data.gender,
    dateOfBirth: data.dateOfBirth,
    onboardingStatus: 'pending',
  });

  const user = await User.create({
    employee: employee._id,
    email,
    role: data.role || 'employee',
    status: 'invited',
  });
  employee.user = user._id;
  await employee.save();

  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  await AccountActivation.create({
    user: user._id,
    tokenHash,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  });

  const activationUrl = env.frontendUrl + '/activate-account?token=' + token;
  await sendActivationEmail(email, data.fullName, activationUrl);

  return { employee, activationUrl };
}

module.exports = { createEmployee };


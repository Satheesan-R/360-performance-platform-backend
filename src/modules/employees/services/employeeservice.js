const crypto = require('crypto');
const Employee = require('../../auth/models/employee');
const User = require('../../auth/models/usermodel');
const Organization = require('../../organization/models/organization');
const AccountActivation = require('../../auth/models/account-activation');
const {
  sendActivationEmail,
  sendOnboardingNotification,
  ensureMailConfigured,
} = require('../../../services/mailservice');
const { env } = require('../../../config/env');
const { resolveDepartment } = require('../../organization/services/departmentservice');
const { resolveEmploymentType } = require('../../organization/services/employmenttypeservice');

const onboardingNotificationRoles = ['employee', 'tech_lead', 'department_manager', 'hr'];

async function notifyOnboardingRecipients(employeeEmail, employeeName, role) {
  const recipients = await User.find({
    email: { $ne: employeeEmail },
    role: { $in: onboardingNotificationRoles },
    status: { $ne: 'disabled' },
  }).select('email').lean();

  const results = await Promise.allSettled(
    recipients.map(({ email }) => sendOnboardingNotification(email, employeeName, role))
  );
  const failed = results
    .map((result, index) => ({ result, email: recipients[index].email }))
    .filter(({ result }) => result.status === 'rejected')
    .map(({ email, result }) => ({ recipient: email, message: result.reason.message }));

  return {
    status: failed.length === 0 ? 'accepted' : 'partial',
    recipients: recipients.map(({ email }) => email),
    failed,
  };
}

async function createEmployee(data) {
  const email = data.companyEmail?.toLowerCase().trim();
  if (!data.fullName || !email) {
    throw new Error('Full name and company email are required');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Company email must be a valid recipient email address');
  ensureMailConfigured();

  if (await User.exists({ email })) throw new Error('A user with this email already exists');

  const names = data.fullName.trim().split(/\s+/);
  const organization = await Organization.findOne({ singletonKey: 'company' });
  const department = data.departmentId != null ? await resolveDepartment(data.departmentId) : null;
  const employmentType = data.employmentTypeId != null ? await resolveEmploymentType(data.employmentTypeId) : null;
  const employee = await Employee.create({
    organizationId: organization ? organization._id : null,
    employeeNumber: data.employeeNumber || 'EMP-' + Date.now(),
    firstName: names.shift(),
    lastName: names.join(' ') || '-',
    workEmail: email,
    personalEmail: data.personalEmail,
    phone: data.phone,
    jobTitle: data.designation,
    departmentId: department ? department._id : null,
    managerId: data.managerId || null,
    JoiningDate: data.contractStartDate,
    employmentTypeId: employmentType ? employmentType._id : null,
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
  let emailDelivery;
  try {
    emailDelivery = await sendActivationEmail(email, data.fullName, activationUrl);
  } catch {
    // The employee already exists. Report delivery separately to avoid duplicate retries.
    emailDelivery = { status: 'failed', recipient: email, message: 'Employee created, but the activation email could not be sent. Check SMTP settings and the recipient address' };
  }

  let onboardingNotifications;
  try {
    onboardingNotifications = await notifyOnboardingRecipients(email, data.fullName, data.role || 'employee');
  } catch (error) {
    onboardingNotifications = {
      status: 'failed',
      recipients: [],
      failed: [{ message: error.message }],
    };
  }

  return { employee, activationUrl, emailDelivery, onboardingNotifications };
}

async function listEmployees() {
  const employees = await Employee.find({})
    .sort({ createdAt: -1, _id: -1 })
    .populate('user', 'email role status')
    .populate('departmentId', 'name code status')
    .populate('employmentTypeId', 'name code isActive')
    .populate('managerId', 'firstName lastName employeeNumber jobTitle')
    .populate('teamId', 'name code status')
    .lean();

  // Accounts activated before onboarding status was synchronized are complete too.
  return employees.map((employee) => ({
    ...employee,
    onboardingStatus: employee.user?.status === 'active'
      ? 'completed'
      : employee.onboardingStatus,
  }));
}

module.exports = { createEmployee, listEmployees };

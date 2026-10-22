const { test } = require('node:test');
const assert = require('node:assert/strict');
const nodemailer = require('nodemailer');
const { env } = require('../src/config/env');
const mail = require('../src/services/mailservice');
const Employee = require('../src/modules/auth/models/employee');
const User = require('../src/modules/auth/models/usermodel');
const Activation = require('../src/modules/auth/models/account-activation');
const employees = require('../src/modules/employees/services/employeeservice');
const controller = require('../src/modules/employees/controllers/employeecontroller');

function configure(t) {
  const old = { smtpUser: env.smtpUser, smtpPass: env.smtpPass, mailFrom: env.mailFrom };
  Object.assign(env, { smtpUser: 'sender@example.com', smtpPass: 'test-only', mailFrom: 'sender@example.com' });
  t.after(() => Object.assign(env, old));
}
function database(t, recipientUsers = []) {
  t.mock.method(User, 'exists', async () => false);
  t.mock.method(User, 'find', () => ({ select: () => ({ lean: async () => recipientUsers }) }));
  t.mock.method(Employee, 'create', async (data) => ({ _id: 'employee', ...data, save: async () => {} }));
  t.mock.method(User, 'create', async () => ({ _id: 'user' }));
  t.mock.method(Activation, 'create', async () => ({}));
}

test('missing email configuration fails before an employee is created', async (t) => {
  configure(t); env.smtpPass = '';
  const lookup = t.mock.method(User, 'exists', async () => false);
  await assert.rejects(employees.createEmployee({ fullName: 'Test Person', companyEmail: 'person@example.com' }), { statusCode: 503 });
  assert.equal(lookup.mock.callCount(), 0);
});

test('activation goes to companyEmail and reports server acceptance without claiming inbox delivery', async (t) => {
  configure(t); database(t);
  t.mock.method(nodemailer, 'createTransport', () => ({ close() {}, sendMail: async (message) => {
    assert.equal(message.to, 'work@example.com');
    assert.match(message.text, /activate-account\?token=/);
    return { accepted: ['work@example.com'] };
  } }));
  const result = await employees.createEmployee({ fullName: 'Test Person', companyEmail: ' WORK@EXAMPLE.COM ', personalEmail: 'personal@example.com', role: 'tech_lead' });
  assert.deepEqual(result.emailDelivery, { status: 'accepted', recipient: 'work@example.com' });
  assert.deepEqual(result.onboardingNotifications, { status: 'accepted', recipients: [], failed: [] });
});

test('onboarding notifications go to all active employee-facing roles', async (t) => {
  configure(t);
  database(t, [
    { email: 'employee@example.com' },
    { email: 'techlead@example.com' },
    { email: 'hr@example.com' },
    { email: 'manager@example.com' },
  ]);
  const sentTo = [];
  t.mock.method(nodemailer, 'createTransport', () => ({
    close() {},
    sendMail: async (message) => {
      sentTo.push(message.to);
      return { accepted: [message.to] };
    },
  }));

  const result = await employees.createEmployee({ fullName: 'Test Person', companyEmail: 'new@example.com' });

  assert.deepEqual(result.onboardingNotifications, {
    status: 'accepted',
    recipients: [
      'employee@example.com',
      'techlead@example.com',
      'hr@example.com',
      'manager@example.com',
    ],
    failed: [],
  });
  assert.deepEqual(sentTo, [
    'new@example.com',
    'employee@example.com',
    'techlead@example.com',
    'hr@example.com',
    'manager@example.com',
  ]);
});

test('SMTP failure and rejected recipients do not produce a false email success', async (t) => {
  configure(t); database(t);
  const transport = t.mock.method(nodemailer, 'createTransport', () => ({ close() {}, sendMail: async () => { throw new Error('SMTP rejected authentication'); } }));
  let result = await employees.createEmployee({ fullName: 'Test Person', companyEmail: 'work@example.com' });
  assert.equal(result.emailDelivery.status, 'failed');
  assert.equal(result.onboardingNotifications.status, 'accepted');
  assert.ok(result.employee);
  transport.mock.mockImplementation(() => ({ close() {}, sendMail: async () => ({ accepted: [], rejected: ['work@example.com'] }) }));
  result = await employees.createEmployee({ fullName: 'Test Person', companyEmail: 'work@example.com' });
  assert.equal(result.emailDelivery.status, 'failed');
});

test('SMTP verification authenticates without sending email and OTP text matches its two-minute expiry', async (t) => {
  configure(t);
  let sent = 0;
  t.mock.method(nodemailer, 'createTransport', () => ({ close() {}, verify: async () => true, sendMail: async (message) => {
    sent++; assert.match(message.text, /2 minutes/); return { accepted: [message.to] };
  } }));
  assert.equal(await mail.verifyMailConnection(), true);
  assert.equal(sent, 0);
  await mail.sendOtpEmail('work@example.com', '123456');
  assert.equal(sent, 1);
});

test('employee response exposes delivery failure while preserving successful account creation', async (t) => {
  t.mock.method(employees, 'createEmployee', async () => ({
    employee: { _id: 'employee' },
    emailDelivery: { status: 'failed', recipient: 'work@example.com', message: 'Employee created, but email could not be sent' },
    onboardingNotifications: { status: 'failed', recipients: [], failed: [] },
  }));
  let status;
  let body;
  await controller.create({ body: {} }, { status(value) { status = value; return this; }, json(value) { body = value; } }, (error) => { throw error; });
  assert.equal(status, 201);
  assert.equal(body.emailDelivery.status, 'failed');
  assert.equal(body.onboardingNotifications.status, 'failed');
  assert.doesNotMatch(body.message, /email sent/);
});

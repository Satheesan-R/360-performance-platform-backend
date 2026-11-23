const nodemailer = require('nodemailer');
const { env } = require('../config/env');

function ensureMailConfigured() {
  if (!env.smtpUser || !env.smtpPass || !env.mailFrom) {
    const error = new Error('Email is not configured. Set SMTP_USER, SMTP_PASS and MAIL_FROM before inviting employees');
    error.statusCode = 503;
    throw error;
  }
}

function getTransporter() {
  ensureMailConfigured();
  return nodemailer.createTransport({
    host: env.smtpHost,
    port: env.smtpPort,
    secure: env.smtpPort === 465,
    auth: { user: env.smtpUser, pass: env.smtpPass },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
  });
}

async function deliver(message) {
  const transporter = getTransporter();
  try {
    const info = await transporter.sendMail(message);
    const accepted = (info.accepted || []).some((address) => String(address).toLowerCase() === message.to.toLowerCase());
    if (!accepted) throw new Error('The mail server did not accept the recipient');
    return { status: 'accepted', recipient: message.to };
  } finally { transporter.close(); }
}

async function verifyMailConnection() {
  const transporter = getTransporter();
  try { return await transporter.verify(); }
  finally { transporter.close(); }
}

async function sendActivationEmail(email, name, activationUrl) {
  return deliver({
    from: env.mailFrom,
    to: email,
    subject: 'Activate your employee account',
    text: 'Hello ' + name + ',\n\nYour employee account is ready. Activate it here:\n' + activationUrl + '\n\nThis link expires in 24 hours. If you did not expect this email, contact HR.',
  });
}

async function sendOtpEmail(email, otp) {
  return deliver({
    from: env.mailFrom,
    to: email,
    subject: 'Your employee account verification code',
    text: 'Your verification code is ' + otp + '. It expires in 2 minutes.',
  });
}

async function sendPasswordChangedEmail(email, changedAt) {
  const transporter = getTransporter();
  if (!transporter) return { status: 'unavailable' };
  let timer;
  try {
    const sending = transporter.sendMail({
      from: env.mailFrom,
      to: email,
      subject: 'Your account password was changed',
      text: 'Your 360 Performance password was changed at ' + changedAt.toISOString() +
        '. All existing sign-ins have ended. If you did not make this change, contact your HR or IT team immediately.',
    });
    // Keep the result inside the frontend's request timeout after the DB write.
    const info = await Promise.race([sending, new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Security email timed out')), 5000);
    })]);
    return { status: (info.accepted || []).some(address => String(address).toLowerCase() === email.toLowerCase()) ? 'accepted' : 'failed' };
  } finally { clearTimeout(timer); transporter.close(); }
}

async function sendSupportNotification(recipients, number, event) {
  const transporter = getTransporter();
  if (!transporter) return { status: 'unavailable' };
  let timer;
  try {
    const info = await Promise.race([transporter.sendMail({
      from: env.mailFrom, bcc: recipients,
      subject: 'Account support update: ' + number,
      text: event + '\nRequest: ' + number + '\nOpen Personal Settings > Account > My Requests or Support Queue to view details.\n' + env.frontendUrl + '/settings?section=account\nNever reply with passwords, OTPs or secret credentials.',
    }), new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error('Support email timed out')), 3000); })]);
    return { status: (info.accepted || []).length === recipients.length ? 'accepted' : 'failed' };
  } finally { clearTimeout(timer); transporter.close(); }
}
module.exports = {
  sendActivationEmail,
  sendOtpEmail,
  ensureMailConfigured,
  verifyMailConnection,
  sendPasswordChangedEmail,
  sendSupportNotification,
};

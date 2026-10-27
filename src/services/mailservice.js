const nodemailer = require('nodemailer');
const { env } = require('../config/env');

function getTransporter() {
  if (!env.smtpUser || !env.smtpPass) return null;
  return nodemailer.createTransport({
    host: env.smtpHost,
    port: env.smtpPort,
    secure: env.smtpPort === 465,
    auth: { user: env.smtpUser, pass: env.smtpPass },
  });
}

async function sendActivationEmail(email, name, activationUrl) {
  const transporter = getTransporter();
  if (!transporter) {
    console.log('Activation link for ' + email + ': ' + activationUrl);
    return;
  }
  await transporter.sendMail({
    from: env.mailFrom,
    to: email,
    subject: 'Activate your employee account',
    text: 'Hello ' + name + ', activate your account here: ' + activationUrl,
  });
}

async function sendOtpEmail(email, otp) {
  const transporter = getTransporter();
  if (!transporter) {
    console.log('Activation OTP for ' + email + ': ' + otp);
    return;
  }
  await transporter.sendMail({
    from: env.mailFrom,
    to: email,
    subject: 'Your employee account verification code',
    text: 'Your verification code is ' + otp + '. It expires in 10 minutes.',
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

module.exports = { sendActivationEmail, sendOtpEmail, sendPasswordChangedEmail };

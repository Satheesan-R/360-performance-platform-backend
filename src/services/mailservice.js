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

module.exports = { sendActivationEmail, sendOtpEmail };

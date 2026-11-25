const { createHash } = require('crypto');
const { fields, fail } = require('../../settings/services/preferences');
const categories = ['LOGIN_PASSWORD', 'ACCESS_PERMISSIONS', 'PROFILE_INFORMATION', 'MFA_SECURITY', 'OTHER_ACCOUNT'];
const queues = ['IT', 'HR'];
const transitions = {
  OPEN: ['IN_PROGRESS', 'ESCALATED', 'RESOLVED'],
  IN_PROGRESS: ['WAITING_FOR_USER', 'ESCALATED', 'RESOLVED'],
  WAITING_FOR_USER: ['IN_PROGRESS', 'ESCALATED', 'RESOLVED'],
  ESCALATED: ['IN_PROGRESS', 'WAITING_FOR_USER', 'RESOLVED'],
  RESOLVED: ['CLOSED', 'REOPENED'], CLOSED: [],
  REOPENED: ['IN_PROGRESS', 'ESCALATED', 'RESOLVED'],
};
function text(value, label, min, max) {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)) fail(`${label} must contain ${min}–${max} characters`);
  const result = value.trim();
  if (/-----BEGIN .*PRIVATE KEY-----|\bBearer\s+[\w.-]{15,}|\beyJ[\w-]{8,}\.[\w-]+\.[\w-]+|\b(?:password|otp|recovery code|api[_ -]?key|access[_ -]?token)\s*[:=]\s*\S+/i.test(result)) fail('Remove passwords, OTPs, tokens and secret credentials before submitting');
  return result;
}
function createInput(body) {
  fields(body, ['category', 'subject', 'description', 'requestId']);
  if (!categories.includes(body.category)) fail('Choose a supported problem category');
  if (typeof body.requestId !== 'string' || !/^[a-zA-Z0-9_-]{16,80}$/.test(body.requestId)) fail('A valid requestId is required');
  return { category: body.category, subject: text(body.subject, 'Subject', 5, 160), description: text(body.description, 'Description', 20, 5000), requestId: body.requestId };
}
function route(category) {
  const configured = category === 'PROFILE_INFORMATION' ? process.env.SUPPORT_PROFILE_QUEUE : process.env.SUPPORT_DEFAULT_QUEUE;
  return queues.includes(configured) ? configured : category === 'PROFILE_INFORMATION' ? 'HR' : 'IT';
}
function objectId(value) { if (!/^[a-f\d]{24}$/i.test(String(value || ''))) fail('Invalid support identifier'); return value; }
const digest = value => createHash('sha256').update(value).digest('hex');
module.exports = { categories, queues, transitions, text, createInput, route, objectId, digest, fields, fail };

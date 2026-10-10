const mongoose = require('mongoose');

function fail(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  throw error;
}

function objectId(value, field) {
  if (typeof value !== 'string' || !mongoose.isObjectIdOrHexString(value)) {
    fail(`${field} must be a valid ID`);
  }
  return value;
}

function fields(body, allowed, required = []) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('A JSON object is required');
  const unknown = Object.keys(body).filter((key) => !allowed.includes(key));
  if (unknown.length) fail(`Unknown fields: ${unknown.join(', ')}`);
  const result = {};
  for (const [key, value] of Object.entries(body)) {
    if (key === 'headEmployeeId') {
      result[key] = value === null ? null : objectId(value, key);
      continue;
    }
    if (typeof value !== 'string') fail(`${key} must be text`);
    result[key] = value.trim();
    const limit = key === 'description' ? 2000 : key === 'logoUrl' ? 2048 : 200;
    if (result[key].length > limit) fail(`${key} is too long`);
    if (['name', 'code'].includes(key) && !result[key]) fail(`${key} is required`);
  }
  for (const key of required) if (!result[key]) fail(`${key} is required`);
  if (!Object.keys(result).length) fail('At least one field is required');
  if (result.code) result.code = result.code.toUpperCase();
  if (result.status && !['active', 'inactive'].includes(result.status)) fail('status must be active or inactive');
  if (result.status === '') fail('status must be active or inactive');
  if (result.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.contactEmail)) fail('contactEmail is invalid');
  if (result.contactEmail) result.contactEmail = result.contactEmail.toLowerCase();
  if (result.logoUrl) {
    try {
      if (!['https:', 'http:'].includes(new URL(result.logoUrl).protocol)) fail('logoUrl must use HTTP or HTTPS');
    } catch { fail('logoUrl must be a valid HTTP or HTTPS URL'); }
  }
  if (result.timezone) {
    try { new Intl.DateTimeFormat('en', { timeZone: result.timezone }); }
    catch { fail('timezone must be a valid timezone, such as Asia/Colombo'); }
  }
  return result;
}

function pagination(query) {
  const integer = (value, fallback, max, field) => {
    if (value === undefined) return fallback;
    if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || Number(value) > max) {
      fail(`${field} must be a positive integer no greater than ${max}`);
    }
    return Number(value);
  };
  return {
    page: integer(query.page, 1, 100000, 'page'),
    limit: integer(query.limit, 20, 100, 'limit'),
  };
}

module.exports = { fail, objectId, fields, pagination };

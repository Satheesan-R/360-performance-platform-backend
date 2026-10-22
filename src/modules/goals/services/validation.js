const { fail, objectId, pagination } = require('../../organization/services/validation');

function bodyFields(body, allowed, required = []) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('A JSON object is required');
  const keys = Object.keys(body);
  if (!keys.length) fail('At least one field is required');
  const unknown = keys.filter((key) => !allowed.includes(key));
  if (unknown.length) fail(`Unknown fields: ${unknown.join(', ')}`);
  for (const key of required) if (!Object.hasOwn(body, key)) fail(`${key} is required`);
  return { ...body };
}

function text(value, name, max = 200, empty = false) {
  if (typeof value !== 'string') fail(`${name} must be text`);
  const result = value.trim();
  if ((!empty && !result) || result.length > max) fail(`${name} must contain ${empty ? '0' : '1'}-${max} characters`);
  return result;
}

function choice(value, name, values) {
  if (!values.includes(value)) fail(`${name} must be one of: ${values.join(', ')}`);
  return value;
}

function date(value, name) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail(`${name} must use YYYY-MM-DD`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) fail(`${name} is invalid`);
  return parsed;
}

function number(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e12) {
    fail(`${name} must be a finite number between -1000000000000 and 1000000000000`);
  }
  return value;
}

function planInput(body, create = false) {
  const data = bodyFields(body, ['name', 'description', 'startDate', 'endDate', ...(create ? [] : ['status'])], create ? ['name', 'startDate', 'endDate'] : []);
  if ('name' in data) data.name = text(data.name, 'name');
  if ('description' in data) data.description = text(data.description, 'description', 2000, true);
  for (const key of ['startDate', 'endDate']) if (key in data) data[key] = date(data[key], key);
  if ('status' in data) choice(data.status, 'status', ['draft', 'active', 'closed', 'archived']);
  return data;
}

function goalInput(body, create = false) {
  const allowed = create ? ['title', 'description', 'planId', 'level', 'ownerEmployeeId', 'teamId', 'parentGoalId'] : ['title', 'description', 'status'];
  const data = bodyFields(body, allowed, create ? ['title', 'planId', 'level', 'ownerEmployeeId'] : []);
  if ('title' in data) data.title = text(data.title, 'title');
  if ('description' in data) data.description = text(data.description, 'description', 2000, true);
  if ('level' in data) choice(data.level, 'level', ['organization', 'team', 'individual']);
  if ('status' in data) choice(data.status, 'status', ['draft', 'active', 'completed', 'cancelled']);
  for (const key of ['planId', 'ownerEmployeeId', 'teamId', 'parentGoalId']) {
    if (key in data) {
      if (['teamId', 'parentGoalId'].includes(key) && data[key] === null) continue;
      data[key] = objectId(data[key], key);
    }
  }
  return data;
}

function keyResultInput(body, create = false) {
  const data = bodyFields(body, ['title', 'type', 'unit', 'startValue', 'targetValue'], create ? ['title', 'type'] : []);
  if ('title' in data) data.title = text(data.title, 'title');
  if ('unit' in data) data.unit = text(data.unit, 'unit', 40, true);
  if ('type' in data) choice(data.type, 'type', ['increase', 'decrease', 'milestone']);
  for (const key of ['startValue', 'targetValue']) if (key in data) number(data[key], key);
  return data;
}

function validateMetric(data) {
  if (data.type === 'milestone') {
    if (data.startValue !== undefined && data.startValue !== 0) fail('Milestones must start at 0');
    if (data.targetValue !== undefined && data.targetValue !== 1) fail('Milestones must target 1');
    data.startValue = 0;
    data.targetValue = 1;
  } else {
    number(data.startValue, 'startValue');
    number(data.targetValue, 'targetValue');
    if (data.type === 'increase' && data.targetValue <= data.startValue) fail('An increase target must exceed its starting value');
    if (data.type === 'decrease' && data.targetValue >= data.startValue) fail('A decrease target must be below its starting value');
  }
  return data;
}

function progress(result) {
  if (result.type === 'milestone') return result.currentValue === 1 ? 100 : 0;
  const raw = ((result.currentValue - result.startValue) / (result.targetValue - result.startValue)) * 100;
  return Math.round(Math.max(0, Math.min(100, raw)) * 100) / 100;
}

function goalProgress(results) {
  if (!results.length) return 0;
  return Math.round(results.reduce((sum, result) => sum + progress(result), 0) / results.length * 100) / 100;
}

function achieved(result) {
  if (result.type === 'milestone') return result.currentValue === 1;
  return result.type === 'increase' ? result.currentValue >= result.targetValue : result.currentValue <= result.targetValue;
}

module.exports = { fail, objectId, pagination, bodyFields, text, choice, number, planInput, goalInput, keyResultInput, validateMetric, progress, goalProgress, achieved };

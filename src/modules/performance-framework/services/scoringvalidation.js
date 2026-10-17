const { fail } = require('../../organization/services/validation');
const { requireValidWeights } = require('./criteriavalidation');
const roles = ['self', 'peer', 'manager'];
const keys = ['ratingScale', 'categoryWeights', 'reviewerWeights', 'enabledReviewers'];

function object(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) fail(`Unknown ${label} fields: ${unknown.join(', ')}`);
}

function weights(value, names, label) {
  object(value, names, label);
  const result = {};
  for (const name of names) {
    const weight = value[name];
    if (typeof weight !== 'number' || !Number.isFinite(weight) || weight < 0 || weight > 100) fail(`${label}.${name} must be a number from 0 to 100`);
    result[name] = weight;
  }
  if (Math.abs(Object.values(result).reduce((sum, weight) => sum + weight, 0) - 100) >= 0.000001) fail(`${label} must total 100%`);
  return result;
}

function parseScoring(body, complete = false) {
  object(body, keys, 'scoring');
  if (!Object.keys(body).length) fail('At least one scoring setting is required');
  if (complete) for (const key of keys) if (body[key] == null) fail(`${key} must be configured before activation`);
  const result = {};
  if (Object.hasOwn(body, 'ratingScale')) {
    const scale = body.ratingScale;
    object(scale, ['min', 'max', 'levels'], 'ratingScale');
    if (scale.min !== 1 || ![3, 4, 5].includes(scale.max)) fail('Rating scale must be 1–3, 1–4 or 1–5');
    if (!Array.isArray(scale.levels) || scale.levels.length !== scale.max) fail('Provide one label for every rating level');
    const seen = new Set();
    const levels = scale.levels.map((level) => {
      object(level, ['value', 'label'], 'rating level');
      if (!Number.isInteger(level.value) || level.value < 1 || level.value > scale.max || seen.has(level.value)) fail('Rating values must cover the scale exactly once');
      if (typeof level.label !== 'string' || !level.label.trim() || level.label.trim().length > 200) fail('Each rating label must contain 1 to 200 characters');
      seen.add(level.value);
      return { value: level.value, label: level.label.trim() };
    }).sort((a, b) => a.value - b.value);
    result.ratingScale = { min: 1, max: scale.max, levels };
  }
  if (Object.hasOwn(body, 'categoryWeights')) result.categoryWeights = weights(body.categoryWeights, ['technical', 'behavioral'], 'categoryWeights');
  if (Object.hasOwn(body, 'reviewerWeights')) result.reviewerWeights = weights(body.reviewerWeights, roles, 'reviewerWeights');
  if (Object.hasOwn(body, 'enabledReviewers')) {
    if (!Array.isArray(body.enabledReviewers) || !body.enabledReviewers.length || body.enabledReviewers.length > 3 || body.enabledReviewers.some((role) => !roles.includes(role)) || new Set(body.enabledReviewers).size !== body.enabledReviewers.length) fail('enabledReviewers must contain unique self, peer or manager roles');
    result.enabledReviewers = [...body.enabledReviewers];
  }
  return result;
}

function settings(framework) {
  return Object.fromEntries(keys.map((key) => [key, framework[key] ?? (key === 'enabledReviewers' ? [] : null)]));
}

function validateReviewers(framework) {
  if (!framework.reviewerWeights || !framework.enabledReviewers?.length) return;
  for (const role of roles) {
    const weight = framework.reviewerWeights[role];
    if (!framework.enabledReviewers.includes(role) && weight !== 0) fail(`Disabled reviewer ${role} must have zero weight`);
    if (framework.enabledReviewers.includes(role) && !(weight > 0)) fail(`Enabled reviewer ${role} must have a positive weight`);
  }
}

function requireScoringReady(framework) {
  requireValidWeights(framework);
  parseScoring(settings(framework), true);
  validateReviewers(framework);
  const active = (framework.competencies || []).filter((item) => (item.status || 'active') === 'active');
  if (active.reduce((sum, item) => sum + item.weight, 0) > 0) {
    for (const category of ['technical', 'behavioral']) {
      if (framework.categoryWeights[category] > 0 && !active.some((item) => item.category === category && item.weight > 0)) fail(`Add a positively weighted ${category} competency or set its category weight to zero`);
    }
  }
}

function scoringStatus(framework) {
  try { requireScoringReady(framework); return { ready: true, message: null }; }
  catch (error) { if (error.statusCode !== 400) throw error; return { ready: false, message: error.message }; }
}

module.exports = { parseScoring, settings, validateReviewers, requireScoringReady, scoringStatus };

const { fail } = require('../../organization/services/validation');

function parseCriterion(body, kind, create = false) {
  const specific = kind === 'competencies' ? ['category'] : ['measurementUnit', 'targetValue', 'targetPeriod'];
  const allowed = ['name', 'description', 'weight', 'status', ...specific];
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('A JSON object is required');
  const unknown = Object.keys(body).filter((key) => !allowed.includes(key));
  if (unknown.length) fail(`Unknown fields: ${unknown.join(', ')}`);
  if (!Object.keys(body).length) fail('At least one field is required');
  const data = {};
  for (const [key, value] of Object.entries(body)) {
    if (['weight', 'targetValue'].includes(key)) {
      if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${key} must be a finite number`);
      if (key === 'weight' && (value < 0 || value > 100)) fail('weight must be between 0 and 100');
      data[key] = value;
    } else {
      if (typeof value !== 'string') fail(`${key} must be text`);
      data[key] = value.trim();
      if (data[key].length > (key === 'description' ? 2000 : 200)) fail(`${key} is too long`);
      if (['name', 'measurementUnit'].includes(key) && !data[key]) fail(`${key} is required`);
    }
  }
  if (data.status !== undefined && !['active', 'inactive'].includes(data.status)) fail('status must be active or inactive');
  if (data.category !== undefined && !['technical', 'behavioral'].includes(data.category)) fail('category must be technical or behavioral');
  if (create) {
    for (const key of ['name', 'weight', ...(kind === 'competencies' ? ['category'] : ['measurementUnit', 'targetValue'])]) {
      if (!Object.hasOwn(data, key)) fail(`${key} is required`);
    }
  }
  return data;
}

function scoringSummary(framework) {
  const active = (items) => (items || []).filter((item) => (item.status || 'active') === 'active');
  const competencies = active(framework.competencies);
  const kpis = active(framework.kpis);
  const all = [...competencies, ...kpis];
  const totalWeight = all.reduce((sum, item) => sum + item.weight, 0);
  const weightsValid = all.every((item) => typeof item.weight === 'number' && Number.isFinite(item.weight) && item.weight >= 0 && item.weight <= 100);
  return {
    competencyCount: competencies.length,
    kpiCount: kpis.length,
    totalWeight,
    weightsValid: weightsValid && all.length > 0 && Math.abs(totalWeight - 100) < 0.000001,
  };
}

function requireValidWeights(framework) {
  if (!scoringSummary(framework).weightsValid) fail('Active competency and KPI weights must total 100% before activating or changing an active framework');
}

module.exports = { parseCriterion, scoringSummary, requireValidWeights };

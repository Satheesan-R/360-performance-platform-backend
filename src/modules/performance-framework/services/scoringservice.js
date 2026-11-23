const Framework = require('../models/performanceframework');
const { loadFramework, versionFilter } = require('./criterionservice');
const { fail } = require('../../organization/services/validation');
const { parseScoring, settings, validateReviewers, requireScoringReady, scoringStatus } = require('./scoringvalidation');
const { preview } = require('./scoringpreview');

function response(framework) {
  return { frameworkId: framework._id, version: framework.__v ?? 0, ...settings(framework), validation: scoringStatus(framework) };
}

async function getScoring(id) { return response(await loadFramework(id)); }

async function updateScoring(id, body) {
  const data = parseScoring(body);
  const framework = await loadFramework(id);
  if (framework.status === 'archived') fail('Move the framework to draft before editing archived scoring', 409);
  const merged = { ...framework, ...data };
  validateReviewers(merged);
  if (framework.status === 'active') requireScoringReady(merged);
  const updated = await Framework.findOneAndUpdate(versionFilter(framework), { $set: data, $inc: { __v: 1 } }, { new: true, runValidators: true }).lean();
  if (!updated) fail('Framework changed while saving. Reload and try again', 409);
  return response(updated);
}

async function previewScoring(id, body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((key) => !['configuration', 'reviewerRatings'].includes(key))) fail('Provide only configuration and/or reviewerRatings');
  const framework = await loadFramework(id);
  const configuration = body.configuration === undefined ? {} : parseScoring(body.configuration);
  return { frameworkId: framework._id, version: framework.__v ?? 0, ...preview({ ...framework, ...configuration }, body.reviewerRatings) };
}

module.exports = { getScoring, updateScoring, previewScoring };

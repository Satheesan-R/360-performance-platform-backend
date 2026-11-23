const Response = require('../models/reviewresponse');
const { effectiveCriteria } = require('../../performance-framework/services/scoringpreview');
const { fail } = require('../../organization/services/validation');

function record(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(label + ' must be an object');
  return value;
}

function fields(value, allowed, label, validate) {
  if (value === undefined) return {};
  return Object.fromEntries(Object.entries(record(value, label)).map(([key, entry]) => {
    if (!allowed.has(key)) fail('Unknown ' + label + ' field');
    return [key, validate(entry)];
  }));
}

function text(value, label, max = 4000) {
  if (value === undefined) return '';
  if (typeof value !== 'string' || value.length > max) fail(label + ' must contain at most ' + max + ' characters');
  return value.trim();
}

function evidence(value) {
  const url = text(value, 'Evidence link', 2048);
  if (!url) return '';
  try {
    const parsed = new URL(url);
    if (['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password) return url;
  } catch {
    // Report a validation error for malformed links.
  }
  fail('Enter a valid HTTP or HTTPS evidence link');
}

function validateResponse(body, configuration) {
  record(body, 'Review response');
  if (Object.keys(body).some((key) => !['version', 'submit', 'sections'].includes(key)) ||
      (body.version !== null && (!Number.isSafeInteger(body.version) || body.version < 0)) ||
      typeof body.submit !== 'boolean' || !Array.isArray(body.sections)) fail('Invalid review response');
  const sections = new Map(configuration.sections.map((section) => [String(section._id), section]));
  if (body.sections.length > sections.size) fail('Too many review sections');
  const scale = configuration.framework.ratingScale;
  const weighted = new Set(body.submit ? effectiveCriteria(configuration.framework)
    .filter((criterion) => criterion.effectiveWeight > 0).map((criterion) => criterion.criterionId) : []);
  const seenSections = new Set();
  const sectionsWithAnswers = body.sections.map((entry) => {
    record(entry, 'Section response');
    if (Object.keys(entry).some((key) => !['sectionId', 'ratings', 'kpiResults', 'answers', 'comment', 'evidenceUrl'].includes(key))) fail('Invalid section response');
    const section = sections.get(entry.sectionId);
    if (!section || seenSections.has(entry.sectionId)) fail('Unknown or duplicate review section');
    seenSections.add(entry.sectionId);
    const criterionIds = new Set([...section.competencyIds, ...section.kpiIds].map(String));
    const ratings = fields(entry.ratings, criterionIds, 'rating', (rating) => {
      if (!Number.isInteger(rating) || !scale.levels.some((level) => level.value === rating)) fail('Choose a rating from the published scale');
      return rating;
    });
    const kpiResults = fields(entry.kpiResults, new Set(section.kpiIds.map(String)), 'KPI result', (result) => {
      if (typeof result !== 'number' || !Number.isFinite(result)) fail('Enter numeric KPI results');
      return result;
    });
    const answers = fields(entry.answers, new Set(section.questions.map((question) => String(question._id))), 'answer', (value) => text(value, 'Answer'));
    const comment = text(entry.comment, 'Comment');
    if (comment && section.allowComments === false) fail('Comments are disabled for ' + section.title);
    const evidenceUrl = evidence(entry.evidenceUrl);
    const required = section.required || [...criterionIds].some((id) => weighted.has(id));
    const completed = Object.keys(ratings).length || Object.keys(kpiResults).length || Object.keys(answers).length || comment || evidenceUrl;
    if (body.submit && (required || completed)) {
      for (const id of criterionIds) {
        if (weighted.has(id) && !Object.hasOwn(ratings, id)) fail('Complete the required ratings in ' + section.title);
      }
      for (const id of section.kpiIds.map(String)) {
        if ((weighted.has(id) || Object.hasOwn(ratings, id)) && !Object.hasOwn(kpiResults, id)) fail('Enter the KPI results in ' + section.title);
      }
      if (section.questions.some((question) => question.required && !answers[String(question._id)])) fail('Answer required questions in ' + section.title);
      if (section.commentsRequired && !comment) fail('Add a comment in ' + section.title);
      if ((section.evidenceRequired || configuration.evidenceRequired) && !evidenceUrl) fail('Add an evidence link in ' + section.title);
    }
    return { sectionId: entry.sectionId, ratings, kpiResults, answers, comment, evidenceUrl };
  });
  if (body.submit) {
    for (const [id, section] of sections) {
      if (!seenSections.has(id) && (section.required || [...section.competencyIds, ...section.kpiIds].some((criterion) => weighted.has(String(criterion))))) {
        fail('Complete ' + section.title);
      }
    }
  }
  return sectionsWithAnswers;
}

async function saveResponse(filter, body, configuration) {
  const sections = validateResponse(body, configuration);
  const submittedAt = body.submit ? new Date() : null;
  let saved;
  if (body.version === null) {
    try {
      saved = await Response.create({ ...filter, sections, submittedAt });
    } catch (error) {
      if (error.code !== 11000) throw error;
    }
  } else {
    saved = await Response.findOneAndUpdate({ ...filter, version: body.version, submittedAt: null }, {
      $set: { sections, submittedAt },
      $inc: { version: 1 },
    }, { new: true }).lean();
  }
  if (!saved) fail('This response was updated or already submitted. Reload it to continue.', 409);
  return { sections: saved.sections, version: saved.version, submittedAt: saved.submittedAt };
}

function participantResult(assignments, responses, framework) {
  const byReviewer = new Map(responses.filter((response) => response.submittedAt)
    .map((response) => [String(response.reviewerEmployeeId), response]));
  const submitted = assignments.filter((assignment) => byReviewer.has(String(assignment.reviewerEmployeeId))).length;
  const progress = { submitted, assigned: assignments.length, score: null, normalizedPercent: null };
  if (!assignments.length || submitted !== assignments.length) return progress;

  const criteria = effectiveCriteria(framework).filter((criterion) => criterion.effectiveWeight > 0);
  const byRole = new Map();
  for (const { reviewerEmployeeId, role } of assignments) {
    const response = byReviewer.get(String(reviewerEmployeeId));
    const ratings = Object.assign({}, ...response.sections.map((section) => section.ratings));
    const score = criteria.reduce((sum, criterion) => sum + ratings[criterion.criterionId] * criterion.effectiveWeight / 100, 0);
    const scores = byRole.get(role) || [];
    scores.push(score);
    byRole.set(role, scores);
  }
  let weight = 0;
  let total = 0;
  for (const [role, scores] of byRole) {
    const roleWeight = framework.reviewerWeights[role];
    total += scores.reduce((sum, score) => sum + score, 0) / scores.length * roleWeight;
    weight += roleWeight;
  }
  const score = total / weight;
  const { min, max } = framework.ratingScale;
  return { ...progress, score, normalizedPercent: (score - min) / (max - min) * 100 };
}

module.exports = { saveResponse, validateResponse, participantResult };

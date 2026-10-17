const { fail } = require('../../organization/services/validation');
const { requireScoringReady } = require('./scoringvalidation');

function effectiveCriteria(framework) {
  requireScoringReady(framework);
  const competencies = (framework.competencies || []).filter((item) => (item.status || 'active') === 'active');
  const kpis = (framework.kpis || []).filter((item) => (item.status || 'active') === 'active');
  const competencyShare = competencies.reduce((sum, item) => sum + item.weight, 0);
  return [
    ...competencies.map((item) => {
      const categoryTotal = competencies.filter((other) => other.category === item.category).reduce((sum, other) => sum + other.weight, 0);
      const effectiveWeight = categoryTotal > 0 ? competencyShare * framework.categoryWeights[item.category] / 100 * item.weight / categoryTotal : 0;
      return { criterionId: String(item._id), type: 'competency', name: item.name, category: item.category, weight: item.weight, effectiveWeight };
    }),
    ...kpis.map((item) => ({ criterionId: String(item._id), type: 'kpi', name: item.name, weight: item.weight, effectiveWeight: item.weight })),
  ];
}

function preview(framework, reviewerRatings) {
  const criteria = effectiveCriteria(framework);
  const result = { criteria, totalEffectiveWeight: criteria.reduce((sum, item) => sum + item.effectiveWeight, 0),
    enabledReviewers: framework.enabledReviewers, reviewerWeights: framework.reviewerWeights,
    ratingScale: framework.ratingScale, sample: null };
  if (reviewerRatings === undefined) return result;
  if (!reviewerRatings || typeof reviewerRatings !== 'object' || Array.isArray(reviewerRatings)) fail('reviewerRatings must be an object');
  const enabled = framework.enabledReviewers;
  if (Object.keys(reviewerRatings).some((role) => !enabled.includes(role))) fail('Ratings may only be supplied for enabled reviewers');
  const contributions = {};
  let score = 0;
  for (const role of enabled) {
    const ratings = reviewerRatings[role];
    if (!ratings || typeof ratings !== 'object' || Array.isArray(ratings)) fail(`Provide criterion ratings for ${role}`);
    if (Object.keys(ratings).some((key) => !criteria.some((item) => item.criterionId === key))) fail('Ratings contain an unknown or inactive criterion');
    let reviewerScore = 0;
    for (const item of criteria) {
      const rating = ratings[item.criterionId];
      if (item.effectiveWeight === 0 && rating === undefined) continue;
      if (!Number.isInteger(rating) || rating < framework.ratingScale.min || rating > framework.ratingScale.max) fail(`Rating for ${role}/${item.criterionId} must be a level in the selected scale`);
      reviewerScore += rating * item.effectiveWeight / 100;
    }
    contributions[role] = reviewerScore;
    score += reviewerScore * framework.reviewerWeights[role] / 100;
  }
  result.sample = { score, normalizedPercent: (score - framework.ratingScale.min) / (framework.ratingScale.max - framework.ratingScale.min) * 100, reviewerScores: contributions };
  return result;
}

module.exports = { effectiveCriteria, preview };

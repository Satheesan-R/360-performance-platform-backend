const { listCriteria, mutateCriterion } = require('./criterionservice');
module.exports = {
  list: (frameworkId, query) => listCriteria(frameworkId, 'kpis', query),
  create: (frameworkId, body) => mutateCriterion(frameworkId, 'kpis', null, body),
  update: (frameworkId, id, body) => mutateCriterion(frameworkId, 'kpis', id, body),
};

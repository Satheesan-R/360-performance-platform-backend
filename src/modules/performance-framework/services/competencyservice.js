const { listCriteria, mutateCriterion } = require('./criterionservice');
module.exports = {
  list: (frameworkId, query) => listCriteria(frameworkId, 'competencies', query),
  create: (frameworkId, body) => mutateCriterion(frameworkId, 'competencies', null, body),
  update: (frameworkId, id, body) => mutateCriterion(frameworkId, 'competencies', id, body),
};

const competencyService = require('../services/competencyservice');
const kpiService = require('../services/kpiservice');

function actions(service, singular) {
  const handle = (operation, status = 200) => async (req, res, next) => {
    try { res.status(status).json(await operation(req)); }
    catch (error) { next(error); }
  };
  const itemResponse = (result) => ({ [singular]: result.criterion, scoring: result.scoring });
  return {
    list: handle((req) => service.list(req.params.id, req.query)),
    create: handle(async (req) => itemResponse(await service.create(req.params.id, req.body)), 201),
    update: handle(async (req) => itemResponse(await service.update(req.params.id, req.params.criterionId, req.body))),
  };
}

module.exports = { competencies: actions(competencyService, 'competency'), kpis: actions(kpiService, 'kpi') };

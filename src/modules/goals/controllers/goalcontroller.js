const service = require('../services/goalservice');

const handle = (operation, key, status = 200) => async (req, res, next) => {
  try {
    const result = await operation(req);
    res.status(status).json({ success: true, ...(key ? { [key]: result } : result) });
  } catch (error) { next(error); }
};

module.exports = {
  createPlan: handle((req) => service.createPlan(req.user, req.body), 'plan', 201),
  listPlans: handle((req) => service.listPlans(req.user, req.query)),
  getPlan: handle((req) => service.getPlan(req.user, req.params.id), 'plan'),
  updatePlan: handle((req) => service.updatePlan(req.user, req.params.id, req.body), 'plan'),
  createGoal: handle((req) => service.createGoal(req.user, req.body), 'goal', 201),
  listGoals: handle((req) => service.listGoals(req.user, req.query)),
  getGoal: handle((req) => service.getGoal(req.user, req.params.id), 'goal'),
  updateGoal: handle((req) => service.updateGoal(req.user, req.params.id, req.body), 'goal'),
  children: handle((req) => service.children(req.user, req.params.id, req.query)),
  createKeyResult: handle((req) => service.createKeyResult(req.user, req.params.id, req.body), 'keyResult', 201),
  updateKeyResult: handle((req) => service.updateKeyResult(req.user, req.params.id, req.body), 'keyResult'),
  createCheckIn: handle((req) => service.createCheckIn(req.user, req.params.id, req.body), null, 201),
  listCheckIns: handle((req) => service.listCheckIns(req.user, req.params.id, req.query)),
};

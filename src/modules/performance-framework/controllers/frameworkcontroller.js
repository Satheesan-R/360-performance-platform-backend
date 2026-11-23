const service = require('../services/frameworkservice');
const handle = (operation, key, status = 200) => async (req, res, next) => {
  try {
    const result = await operation(req);
    res.status(status).json(key ? { [key]: result } : result);
  } catch (error) { next(error); }
};

module.exports = {
  list: handle((req) => service.listFrameworks(req.query)),
  get: handle((req) => service.getFramework(req.params.id), 'framework'),
  create: handle((req) => service.createFramework(req.body, req.user.id), 'framework', 201),
  update: handle((req) => service.updateFramework(req.params.id, req.body), 'framework'),
  summary: handle(() => service.getSummary(), 'summary'),
};

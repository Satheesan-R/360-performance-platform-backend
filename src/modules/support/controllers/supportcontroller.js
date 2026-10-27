const service = require('../services/supportservice');
const handle = (fn, status = 200) => async (req, res, next) => { try { const result = await fn(req); res.status(result.replayed ? 200 : status).json(result); } catch (error) { next(error); } };
module.exports = {
  context: handle(req => service.context(req.user)), create: handle(req => service.create(req.user, req.body), 201), list: handle(req => service.list(req.user, req.query)), get: handle(req => service.get(req.user, req.params.id)),
  message: handle(req => service.mutate(req.user, req.params.id, 'MESSAGE', req.body)), assign: handle(req => service.mutate(req.user, req.params.id, 'ASSIGNED', req.body)), status: handle(req => service.mutate(req.user, req.params.id, 'STATUS_CHANGED', req.body)), reopen: handle(req => service.mutate(req.user, req.params.id, 'REOPENED', req.body)),
  officers: handle(req => service.officers(req.user, req.query.queue)), membership: handle(req => service.membership(req.user, req.body)),
};

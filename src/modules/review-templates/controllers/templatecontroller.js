const service = require('../services/templateservice');
const { previewTemplate } = require('../services/templatepreview');
const snapshots = require('../services/templatesnapshotservice');
const handle = (operation, key, status = 200) => async (req, res, next) => {
  try {
    const result = await operation(req);
    res.status(status).json(key ? { [key]: result } : result);
  } catch (error) { next(error); }
};
module.exports = {
  list: handle((req) => service.listTemplates(req.query)),
  get: handle((req) => service.getTemplate(req.params.id), 'template'),
  create: handle((req) => service.createTemplate(req.body, req.user.id), 'template', 201),
  update: handle((req) => service.updateTemplate(req.params.id, req.body), 'template'),
  preview: handle((req) => previewTemplate(req.params.id, req.body), 'preview'),
  createSnapshot: handle((req) => snapshots.createSnapshot(req.params.id, req.user.id, req.body), 'snapshot', 201),
  getSnapshot: handle((req) => snapshots.getSnapshot(req.params.id, req.params.snapshotId), 'snapshot'),
};

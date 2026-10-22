const scoring = require('../services/scoringservice');
const snapshots = require('../services/snapshotservice');
const handle = (operation, key, status = 200) => async (req, res, next) => {
  try { res.status(status).json({ [key]: await operation(req) }); }
  catch (error) { next(error); }
};

module.exports = {
  get: handle((req) => scoring.getScoring(req.params.id), 'scoring'),
  update: handle((req) => scoring.updateScoring(req.params.id, req.body), 'scoring'),
  preview: handle((req) => scoring.previewScoring(req.params.id, req.body), 'preview'),
  createSnapshot: handle((req) => snapshots.createSnapshot(req.params.id, req.user.id, req.body), 'snapshot', 201),
  getSnapshot: handle((req) => snapshots.getSnapshot(req.params.id, req.params.snapshotId), 'snapshot'),
};

const express = require('express');
const service = require('../services/cycleservice');
const { authenticate, allowRoles } = require('../../../middleware/auth');

const router = express.Router();
router.use(authenticate);
// A full draft can include up to 2,000 reviewer assignments.
const draftJson = express.json({ limit: '512kb' });

router.post('/', allowRoles('hr'), draftJson, async (req, res, next) => {
  try { res.status(201).json({ cycle: await service.createCycle(req.body, req.user.id) }); }
  catch (error) { next(error); }
});

router.get('/', allowRoles('hr', 'admin'), async (req, res, next) => {
  try { res.json(await service.listCycles(req.query)); }
  catch (error) { next(error); }
});

router.get('/:id', allowRoles('hr', 'admin'), async (req, res, next) => {
  try { res.json({ cycle: await service.getCycle(req.params.id) }); }
  catch (error) { next(error); }
});

router.patch('/:id', allowRoles('hr'), draftJson, async (req, res, next) => {
  try { res.json({ cycle: await service.updateCycle(req.params.id, req.body, req.user.id) }); }
  catch (error) { next(error); }
});

module.exports = router;

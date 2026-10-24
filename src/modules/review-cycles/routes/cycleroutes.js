const express = require('express');
const service = require('../services/cycleservice');
const { authenticate, allowRoles } = require('../../../middleware/auth');

const router = express.Router();
router.use(authenticate);

router.post('/', allowRoles('hr'), async (req, res, next) => {
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

module.exports = router;

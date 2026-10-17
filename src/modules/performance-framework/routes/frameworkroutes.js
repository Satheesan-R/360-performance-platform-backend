const express = require('express');
const controller = require('../controllers/frameworkcontroller');
const criteria = require('../controllers/criteriacontroller');
const scoring = require('../controllers/scoringcontroller');
const { authenticate, allowRoles } = require('../../../middleware/auth');

const router = express.Router();
router.use(authenticate, allowRoles('hr', 'admin'));
router.get('/', controller.list);
router.get('/summary', controller.summary);
router.get('/:id', controller.get);
router.post('/', controller.create);
router.patch('/:id', controller.update);
router.get('/:id/competencies', criteria.competencies.list);
router.post('/:id/competencies', criteria.competencies.create);
router.patch('/:id/competencies/:criterionId', criteria.competencies.update);
router.get('/:id/kpis', criteria.kpis.list);
router.post('/:id/kpis', criteria.kpis.create);
router.patch('/:id/kpis/:criterionId', criteria.kpis.update);
router.get('/:id/scoring', scoring.get);
router.patch('/:id/scoring', scoring.update);
router.post('/:id/scoring/preview', scoring.preview);
router.post('/:id/snapshots', scoring.createSnapshot);
router.get('/:id/snapshots/:snapshotId', scoring.getSnapshot);

module.exports = router;

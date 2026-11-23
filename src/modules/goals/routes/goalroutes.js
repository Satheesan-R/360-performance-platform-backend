const express = require('express');
const controller = require('../controllers/goalcontroller');
const { authenticate } = require('../../../middleware/auth');

const router = express.Router();
router.use(['/goal-plans', '/goals', '/key-results'], authenticate);
router.route('/goal-plans').get(controller.listPlans).post(controller.createPlan);
router.route('/goal-plans/:id').get(controller.getPlan).patch(controller.updatePlan);
router.route('/goals').get(controller.listGoals).post(controller.createGoal);
router.route('/goals/:id').get(controller.getGoal).patch(controller.updateGoal);
router.get('/goals/:id/children', controller.children);
router.post('/goals/:id/key-results', controller.createKeyResult);
router.patch('/key-results/:id', controller.updateKeyResult);
router.route('/key-results/:id/check-ins').get(controller.listCheckIns).post(controller.createCheckIn);

module.exports = router;

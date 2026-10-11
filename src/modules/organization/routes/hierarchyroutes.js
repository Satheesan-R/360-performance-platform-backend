const express = require('express');
const controller = require('../controllers/organizationcontroller');
const { authenticate, allowRoles } = require('../../../middleware/auth');
const router = express.Router();
router.use(authenticate, allowRoles('hr', 'admin'));
router.get('/', controller.hierarchy);
router.patch('/:id/manager', controller.assignManager);
module.exports = router;

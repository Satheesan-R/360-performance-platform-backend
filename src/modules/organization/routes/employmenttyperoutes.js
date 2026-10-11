const express = require('express');
const controller = require('../controllers/organizationcontroller');
const { authenticate, allowRoles } = require('../../../middleware/auth');

const router = express.Router();
router.use(authenticate, allowRoles('hr', 'admin'));
router.get('/', controller.employmentTypes);
router.post('/', controller.createEmploymentType);
router.post('/defaults', controller.initializeEmploymentTypes);
router.patch('/:id', controller.updateEmploymentType);
module.exports = router;

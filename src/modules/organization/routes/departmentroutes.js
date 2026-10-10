const express = require('express');
const controller = require('../controllers/organizationcontroller');
const { authenticate, allowRoles } = require('../../../middleware/auth');

const router = express.Router();
router.use(authenticate, allowRoles('hr', 'admin'));
router.get('/', controller.departments);
router.post('/', controller.createDepartment);
router.patch('/:id', controller.updateDepartment);

module.exports = router;

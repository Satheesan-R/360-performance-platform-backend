const express = require('express');
const controller = require('../controllers/employeecontroller');
const organizationController = require('../../organization/controllers/organizationcontroller');
const { authenticate, allowRoles } = require('../../../middleware/auth');

const router = express.Router();
router.get('/', authenticate, allowRoles('hr', 'admin'), controller.list);
router.post('/', authenticate, allowRoles('hr', 'admin'), controller.create);
router.patch('/:id/department', authenticate, allowRoles('hr', 'admin'), organizationController.assignDepartment);

module.exports = router;

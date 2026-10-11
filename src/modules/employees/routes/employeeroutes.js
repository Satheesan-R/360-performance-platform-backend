const express = require('express');
const controller = require('../controllers/employeecontroller');
const organizationController = require('../../organization/controllers/organizationcontroller');
const { authenticate, allowRoles } = require('../../../middleware/auth');

const router = express.Router();
router.get('/', authenticate, allowRoles('hr', 'admin'), controller.list);
router.post('/', authenticate, allowRoles('hr', 'admin'), controller.create);
router.patch('/:id/department', authenticate, allowRoles('hr', 'admin'), organizationController.assignDepartment);
router.patch('/:id/employment-type', authenticate, allowRoles('hr', 'admin'), organizationController.assignEmploymentType);
router.patch('/:id/manager', authenticate, allowRoles('hr', 'admin'), organizationController.assignManager);

module.exports = router;

const express = require('express');
const controller = require('../controllers/organizationcontroller');
const { authenticate, allowRoles } = require('../../../middleware/auth');

const router = express.Router();
router.use(authenticate, allowRoles('hr', 'admin'));
router.get('/', controller.departments);
router.post('/', controller.createDepartment);
router.get('/summary', controller.departmentSummary);
router.get('/:id', controller.departmentDetails);
router.get('/:id/teams', controller.departmentTeams);
router.get('/:id/employees', controller.departmentEmployees);
router.get('/:id/hierarchy', controller.departmentHierarchy);
router.patch('/:id', controller.updateDepartment);
router.delete('/:id', controller.deactivateDepartment);

module.exports = router;

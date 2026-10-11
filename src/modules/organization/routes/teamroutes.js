const express = require('express');
const controller = require('../controllers/organizationcontroller');
const { authenticate, allowRoles } = require('../../../middleware/auth');

const router = express.Router();
router.use(authenticate, allowRoles('hr', 'admin'));
router.get('/', controller.teams);
router.post('/', controller.createTeam);
router.patch('/:id', controller.updateTeam);

module.exports = router;

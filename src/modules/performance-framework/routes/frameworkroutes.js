const express = require('express');
const controller = require('../controllers/frameworkcontroller');
const { authenticate, allowRoles } = require('../../../middleware/auth');

const router = express.Router();
router.use(authenticate, allowRoles('hr', 'admin'));
router.get('/', controller.list);
router.get('/summary', controller.summary);
router.get('/:id', controller.get);
router.post('/', controller.create);
router.patch('/:id', controller.update);

module.exports = router;

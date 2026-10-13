const express = require('express');
const controller = require('../controllers/settingscontroller');
const { authenticate } = require('../../../middleware/auth');

const router = express.Router();
router.use(authenticate);
router.get('/profile', controller.profile);
router.patch('/password', controller.changePassword);
router.patch('/profile', controller.updateProfile);

module.exports = router;


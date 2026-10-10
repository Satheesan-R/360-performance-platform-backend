const express = require('express');
const authController = require('../controllers/authcontroller');

const router = express.Router();
router.post('/login', authController.login);
router.post('/activation/send-otp', authController.sendOtp);
router.post('/activation/verify-otp', authController.verifyOtp);
router.post('/activation/create-password', authController.createPassword);

module.exports = router;

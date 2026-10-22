const express = require('express');
const { rateLimit } = require('express-rate-limit');
const authController = require('../controllers/authcontroller');

const router = express.Router();

const loginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { success: false, message: 'Too many login attempts. Please try again later.' },
});

const sendOtpRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 3,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { success: false, message: 'Too many OTP requests. Please try again later.' },
});

const verifyOtpRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { success: false, message: 'Too many OTP attempts. Please try again later.' },
});

router.post('/login', loginRateLimit, authController.login);
router.post('/activation/send-otp', sendOtpRateLimit, authController.sendOtp);
router.post('/activation/verify-otp', verifyOtpRateLimit, authController.verifyOtp);
router.post('/activation/create-password', authController.createPassword);

module.exports = router;

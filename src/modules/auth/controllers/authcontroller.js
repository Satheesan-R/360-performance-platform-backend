const authService = require('../services/authservice');

async function login(req, res, next) {
  try {
    const { token, user } = await authService.login(req.body.email, req.body.password);
    const dashboards = {
      employee: '/employee/dashboard',
      tech_lead: '/tech-lead/dashboard',
      department_manager: '/manager/dashboard',
      hr: '/hr/dashboard',
      admin: '/admin/dashboard',
    };
    res.json({
      message: 'Login successful',
      token,
      redirectTo: dashboards[user.role],
      user: { id: user._id, email: user.email, role: user.role },
    });
  } catch (error) {
    error.statusCode = 401;
    next(error);
  }
}

async function sendOtp(req, res, next) {
  try {
    const maskedEmail = await authService.sendActivationOtp(req.body.token);
    res.json({ message: 'OTP sent to your company email', email: maskedEmail });
  } catch (error) {
    error.statusCode = 400;
    next(error);
  }
}

async function verifyOtp(req, res, next) {
  try {
    const setupToken = await authService.verifyActivationOtp(req.body.token, req.body.otp);
    res.json({ message: 'Email verified', setupToken });
  } catch (error) {
    error.statusCode = 400;
    next(error);
  }
}

async function createPassword(req, res, next) {
  try {
    await authService.createPassword(req.body.setupToken, req.body.password);
    res.json({ message: 'Account created successfully. You can now log in.' });
  } catch (error) {
    error.statusCode = 400;
    next(error);
  }
}

module.exports = { login, sendOtp, verifyOtp, createPassword };

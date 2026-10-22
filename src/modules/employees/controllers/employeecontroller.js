const employeeService = require('../services/employeeservice');

async function list(req, res, next) {
  try {
    const employees = await employeeService.listEmployees();
    res.json({ employees });
  } catch (error) {
    next(error);
  }
}

async function create(req, res, next) {
  try {
    const result = await employeeService.createEmployee(req.body);
    res.status(201).json({
      message: result.emailDelivery.status === 'accepted'
        ? 'Employee created. Activation email accepted by the mail server'
        : result.emailDelivery.message,
      emailDelivery: result.emailDelivery,
      onboardingNotifications: result.onboardingNotifications,
      employee: result.employee,
      ...(process.env.NODE_ENV !== 'production' && { activationUrl: result.activationUrl }),
    });
  } catch (error) {
    error.statusCode = error.statusCode || 400;
    next(error);
  }
}

module.exports = { create, list };

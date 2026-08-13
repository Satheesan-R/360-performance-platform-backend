const employeeService = require('../services/employeeservice');

async function create(req, res, next) {
  try {
    const result = await employeeService.createEmployee(req.body);
    res.status(201).json({
      message: 'Employee created and activation email sent',
      employee: result.employee,
      ...(process.env.NODE_ENV !== 'production' && { activationUrl: result.activationUrl }),
    });
  } catch (error) {
    error.statusCode = 400;
    next(error);
  }
}

module.exports = { create };

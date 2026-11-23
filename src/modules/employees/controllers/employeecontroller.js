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
    const emailAccepted = result.emailDelivery.status === 'accepted';
    res.status(201).json({
      message: emailAccepted
        ? 'Employee created. Activation email accepted by the mail server'
        : 'Employee created, but the activation email could not be sent',
      emailDelivery: result.emailDelivery,
      employee: result.employee,
      ...(process.env.NODE_ENV !== 'production' && { activationUrl: result.activationUrl }),
    });
  } catch (error) {
    error.statusCode = error.statusCode || 400;
    next(error);
  }
}

async function get(req, res, next) {
  try {
    const employee = await employeeService.getEmployee(req.params.id);
    res.json({ employee });
  } catch (error) {
    next(error);
  }
}

module.exports = { create, list, get };

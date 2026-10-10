const Department = require('../models/department');
const Employee = require('../../auth/models/employee');
const { fail, objectId, fields, pagination } = require('./validation');

const allowed = ['name', 'code', 'description', 'headEmployeeId', 'status'];

async function validateHead(data) {
  if (data.headEmployeeId && !await Employee.exists({ _id: data.headEmployeeId })) {
    fail('Department head employee was not found', 404);
  }
}

async function createDepartment(body) {
  const data = fields(body, allowed, ['name', 'code']);
  await validateHead(data);
  const department = await Department.create(data);
  return department.populate('headEmployeeId', 'employeeNumber firstName lastName workEmail');
}

async function updateDepartment(id, body) {
  objectId(id, 'departmentId');
  const data = fields(body, allowed);
  const department = await Department.findById(id);
  if (!department) fail('Department was not found', 404);
  await validateHead(data);
  Object.assign(department, data);
  await department.save();
  return department.populate('headEmployeeId', 'employeeNumber firstName lastName workEmail');
}

async function listDepartments(query) {
  const { page, limit } = pagination(query);
  const filter = {};
  if (query.status !== undefined) {
    if (!['active', 'inactive'].includes(query.status)) fail('status must be active or inactive');
    filter.status = query.status;
  }
  if (query.search !== undefined) {
    if (typeof query.search !== 'string' || query.search.length > 200) fail('search must be text up to 200 characters');
    const escaped = query.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [{ name: { $regex: escaped, $options: 'i' } }, { code: { $regex: escaped, $options: 'i' } }];
  }
  const [departments, total] = await Promise.all([
    Department.find(filter).sort({ name: 1, _id: 1 }).skip((page - 1) * limit).limit(limit)
      .populate('headEmployeeId', 'employeeNumber firstName lastName workEmail').lean(),
    Department.countDocuments(filter),
  ]);
  const counts = await Employee.aggregate([
    { $match: { departmentId: { $in: departments.map((department) => department._id) } } },
    { $group: { _id: '$departmentId', count: { $sum: 1 } } },
  ]);
  const countById = new Map(counts.map((item) => [String(item._id), item.count]));
  return {
    departments: departments.map((department) => ({ ...department, employeeCount: countById.get(String(department._id)) || 0 })),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

async function resolveDepartment(id) {
  objectId(id, 'departmentId');
  const department = await Department.findById(id);
  if (!department) fail('Department was not found', 404);
  if (department.status !== 'active') fail('Cannot assign an employee to an inactive department');
  return department;
}

async function assignDepartment(employeeId, body) {
  objectId(employeeId, 'employeeId');
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 || !Object.hasOwn(body, 'departmentId')) {
    fail('Provide only departmentId, or null to remove the assignment');
  }
  const department = body.departmentId === null ? null : await resolveDepartment(body.departmentId);
  const employee = await Employee.findById(employeeId);
  if (!employee) fail('Employee was not found', 404);
  employee.departmentId = department ? department._id : null;
  // Keep the old field readable by the current frontend during its transition.
  employee.department = department ? department.name : '';
  await employee.save();
  return employee.populate('departmentId', 'name code status');
}

module.exports = { createDepartment, updateDepartment, listDepartments, resolveDepartment, assignDepartment };

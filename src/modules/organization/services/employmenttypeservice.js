const EmploymentType = require('../models/employmenttype');
const Organization = require('../models/organization');
const Employee = require('../../auth/models/employee');
const { fail, objectId, fields, pagination } = require('./validation');

const allowed = ['name', 'code', 'description', 'isActive'];
const legacyValues = { INTERN: 'intern', PROBATION: 'probation', PERMANENT: 'full-time' };
const defaults = [
  { name: 'Intern', code: 'INTERN', description: 'Employees on an internship' },
  { name: 'Probationary', code: 'PROBATION', description: 'Employees on probation' },
  { name: 'Permanent', code: 'PERMANENT', description: 'Permanent employees' },
];

async function company() {
  const organization = await Organization.findOne({ singletonKey: 'company' });
  if (!organization) fail('Set up the organization before managing employment types', 409);
  return organization;
}

async function createEmploymentType(body) {
  const data = fields(body, allowed, ['name', 'code']);
  const organization = await company();
  return EmploymentType.create({ ...data, organizationId: organization._id });
}

async function updateEmploymentType(id, body) {
  objectId(id, 'employmentTypeId');
  const data = fields(body, allowed);
  const organization = await company();
  const type = await EmploymentType.findOne({ _id: id, organizationId: organization._id });
  if (!type) fail('Employment type was not found', 404);
  Object.assign(type, data);
  return type.save();
}

async function listEmploymentTypes(query) {
  const { page, limit } = pagination(query);
  const organization = await company();
  const filter = { organizationId: organization._id };
  if (query.status !== undefined) {
    if (!['active', 'inactive'].includes(query.status)) fail('status must be active or inactive');
    filter.isActive = query.status === 'active';
  }
  if (query.isActive !== undefined) {
    if (!['true', 'false'].includes(query.isActive)) fail('isActive must be true or false');
    const active = query.isActive === 'true';
    if (filter.isActive !== undefined && filter.isActive !== active) fail('status and isActive filters conflict');
    filter.isActive = active;
  }
  if (query.search !== undefined) {
    if (typeof query.search !== 'string' || query.search.length > 200) fail('search must be text up to 200 characters');
    const escaped = query.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [{ name: { $regex: escaped, $options: 'i' } }, { code: { $regex: escaped, $options: 'i' } }];
  }
  const [employmentTypes, total] = await Promise.all([
    EmploymentType.find(filter).sort({ name: 1, _id: 1 }).skip((page - 1) * limit).limit(limit).lean(),
    EmploymentType.countDocuments(filter),
  ]);
  return { employmentTypes, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
}

async function initializeDefaults() {
  const organization = await company();
  for (const type of defaults) {
    // Preserve HR's labels and inactive statuses when called again.
    await EmploymentType.updateOne({ organizationId: organization._id, code: type.code }, {
      $setOnInsert: { ...type, organizationId: organization._id, isActive: true, createdAt: new Date(), updatedAt: new Date() },
    }, { upsert: true, runValidators: true, timestamps: false });
  }
  return EmploymentType.find({ organizationId: organization._id, code: { $in: defaults.map((type) => type.code) } }).sort({ name: 1 }).lean();
}

async function resolveEmploymentType(id) {
  objectId(id, 'employmentTypeId');
  const organization = await company();
  const type = await EmploymentType.findOne({ _id: id, organizationId: organization._id });
  if (!type) fail('Employment type was not found', 404);
  if (!type.isActive) fail('Cannot assign an inactive employment type');
  return type;
}

function legacyValue(type) { return legacyValues[type.code] || type.code.toLowerCase(); }

async function assignEmploymentType(employeeId, body) {
  objectId(employeeId, 'employeeId');
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 || !Object.hasOwn(body, 'employmentTypeId')) {
    fail('Provide only employmentTypeId');
  }
  const type = await resolveEmploymentType(body.employmentTypeId);
  const employee = await Employee.findById(employeeId);
  if (!employee) fail('Employee was not found', 404);
  employee.employmentTypeId = type._id;
  employee.employmentType = legacyValue(type);
  await employee.save();
  return employee.populate('employmentTypeId', 'name code isActive');
}

module.exports = { createEmploymentType, updateEmploymentType, listEmploymentTypes, initializeDefaults, resolveEmploymentType, assignEmploymentType, legacyValue };

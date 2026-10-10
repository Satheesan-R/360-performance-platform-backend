const Organization = require('../models/organization');
const Department = require('../models/department');
const Employee = require('../../auth/models/employee');
const { fields } = require('./validation');

const allowed = ['name', 'code', 'logoUrl', 'industry', 'description', 'contactEmail', 'country', 'timezone', 'status'];

async function getOrganization() {
  return Organization.findOne({ singletonKey: 'company' }).lean();
}

async function updateOrganization(body) {
  const data = fields(body, allowed);
  const existing = await Organization.findOne({ singletonKey: 'company' });
  if (existing) {
    Object.assign(existing, data);
    return existing.save();
  }
  fields(body, allowed, ['name', 'code']);
  return Organization.create({ ...data, singletonKey: 'company' });
}

async function getSummary() {
  const [totalEmployees, departments, activeDepartments] = await Promise.all([
    Employee.countDocuments({}),
    Department.countDocuments({}),
    Department.countDocuments({ status: 'active' }),
  ]);
  // These modules do not exist yet; null distinguishes unavailable counts from zero.
  return { totalEmployees, departments, activeDepartments, teams: null, activeReviewFrameworks: null };
}

module.exports = { getOrganization, updateOrganization, getSummary };

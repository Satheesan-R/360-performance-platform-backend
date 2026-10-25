const { test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const User = require('../src/modules/auth/models/usermodel');
const Employee = require('../src/modules/auth/models/employee');
const Organization = require('../src/modules/organization/models/organization');
const Department = require('../src/modules/organization/models/department');
const Correction = require('../src/modules/settings/models/profile-correction');
const details = require('../src/modules/settings/services/profile-details');
const service = require('../src/modules/settings/services/settingsservice');
const corrections = require('../src/modules/settings/services/profile-corrections');
const sharing = require('../src/modules/settings/services/profile-sharing');
const id = '507f1f77bcf86cd799439011', employeeId = '507f1f77bcf86cd799439012', companyId = '507f1f77bcf86cd799439013', otherId = '507f1f77bcf86cd799439014', correctionId = '507f1f77bcf86cd799439015';
function user(role = 'employee') { return { _id: id, email: 'self@example.com', role, status: 'active', employee: { _id: employeeId, organizationId: companyId, firstName: 'Own', lastName: 'Profile', jobTitle: 'Engineer', employeeNumber: 'EMP-1' } }; }
function query(value) { return { select() { return this; }, populate() { return this; }, session() { return this; }, sort() { return this; }, limit() { return this; }, lean: async () => value, then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); } }; }
function mockUser(t, value) { t.mock.method(User, 'findById', () => query(value)); }
function company(t) { t.mock.method(Organization, 'findOne', async () => ({ _id: companyId })); t.mock.method(Organization, 'findOneAndUpdate', async () => ({ _id: companyId })); }

test('profile details validate URLs, photo formats, limits, duplicate skills and strict field allowlists', () => {
  const value = details.defaults();
  value.bio = '  Frontend engineer  '; value.links = [{ label: 'Portfolio', url: 'https://example.com' }];
  value.skills = [{ name: 'React', proficiency: 'advanced', developing: true }];
  assert.equal(details.validate(value).bio, 'Frontend engineer');
  for (const url of ['javascript:alert(1)', 'data:text/html,hello', 'file:///secret', 'https://user:password@example.com', 'not a URL']) assert.throws(() => details.validate({ ...value, links: [{ label: 'Bad', url }] }));
  for (const invalid of [{ photo: 'data:image/svg+xml;base64,abc' }, { photo: 'data:image/jpeg;base64,/9j/AAAA' }, { bio: 'x'.repeat(501) }, { careerInterests: 'x'.repeat(1001) }, { careerVisibility: 'everyone' }, { userId: otherId }, { skills: [...value.skills, { ...value.skills[0], name: ' REACT ' }] }, { links: Array(6).fill(value.links[0]) }]) assert.throws(() => details.validate({ ...value, ...invalid }));
  assert.equal(new User({ email: 'schema@example.com' }).profileDetails.careerVisibility, 'private');
});

test('details save only on the authenticated account and preserve employment protections', async t => {
  const own = user(); mockUser(t, own);
  const write = t.mock.method(User, 'updateOne', async (filter, update) => { assert.deepEqual(filter, { _id: id, status: 'active', role: 'employee' }); own.profileDetails = update.$set.profileDetails; return { matchedCount: 1 }; });
  const result = await service.updateProfile({ id, role: 'employee' }, { details: { ...details.defaults(), bio: 'My bio' } });
  assert.equal(result.details.bio, 'My bio'); assert.equal(result.capabilities.extendedProfile, true);
  for (const body of [{ details: { ...details.defaults(), role: 'admin' } }, { jobTitle: 'Director' }, { details: details.defaults(), phone: '' }]) await assert.rejects(service.updateProfile({ id, role: 'employee' }, body), { statusCode: 400 });
  assert.equal(write.mock.callCount(), 1);
});

test('corrections derive ownership and original value on the server; employee cannot review', async t => {
  mockUser(t, user()); company(t);
  const created = t.mock.method(Correction, 'create', async body => { assert.equal(body.requester, id); assert.equal(body.employee, employeeId); assert.equal(body.currentValue, 'Engineer'); assert.equal(body.organizationId, companyId); return { ...body, _id: correctionId, status: 'pending', createdAt: new Date() }; });
  const request = await corrections.create({ id, role: 'employee' }, { field: 'jobTitle', proposedValue: 'Senior engineer', reason: 'Promotion was recorded incorrectly' });
  assert.equal(request.status, 'pending');
  for (const body of [{ field: 'role', proposedValue: 'admin', reason: 'No' }, { field: 'jobTitle', proposedValue: 'Engineer', reason: 'Same' }, { field: 'department', proposedValue: 'Engineering', reason: 'Move', requester: otherId }]) await assert.rejects(corrections.create({ id, role: 'employee' }, body), { statusCode: 400 });
  await assert.rejects(corrections.review({ id, role: 'employee' }, correctionId, { decision: 'approved', note: '' }), { statusCode: 403 });
  await assert.rejects(corrections.list({ id, role: 'employee' }, true), { statusCode: 403 });
  assert.equal(created.mock.callCount(), 1);
});

function setupReview(t, overrides = {}) {
  mockUser(t, user('hr')); company(t);
  t.mock.method(mongoose.connection, 'transaction', async work => work({ fixture: true }));
  const employee = { _id: employeeId, organizationId: companyId, jobTitle: 'Engineer', firstName: 'Own', lastName: 'Profile', managerId: null };
  const request = { _id: correctionId, requester: otherId, employee: employeeId, organizationId: companyId, field: 'jobTitle', currentValue: 'Engineer', proposedValue: 'Senior engineer', reason: 'Correction', status: 'pending', createdAt: new Date(), ...overrides, async save() { this.saved = true; } };
  t.mock.method(Correction, 'findOne', filter => { assert.equal(filter.organizationId, companyId); return query(request); });
  t.mock.method(Employee, 'findById', () => query(employee));
  const write = t.mock.method(Employee, 'updateOne', async (filter, update, options) => { assert.equal(filter._id, employeeId); assert.equal(options.session.fixture, true); Object.assign(employee, update.$set); return { matchedCount: 1 }; });
  return { request, employee, write };
}
test('HR approval commits employment update and decision in the same transaction', async t => {
  const { request, employee, write } = setupReview(t);
  const result = await corrections.review({ id, role: 'hr' }, correctionId, { decision: 'approved', note: 'Verified' });
  assert.equal(employee.jobTitle, 'Senior engineer'); assert.equal(result.status, 'approved'); assert.equal(request.saved, true); assert.equal(write.mock.callCount(), 1);
});
test('rejections require a note and do not change official records', async t => {
  const { employee, write } = setupReview(t);
  await assert.rejects(corrections.review({ id, role: 'hr' }, correctionId, { decision: 'rejected', note: '' }), { statusCode: 400 });
  const result = await corrections.review({ id, role: 'hr' }, correctionId, { decision: 'rejected', note: 'Please confirm with your manager' });
  assert.equal(result.status, 'rejected'); assert.equal(employee.jobTitle, 'Engineer'); assert.equal(write.mock.callCount(), 0);
});
test('self-review, repeated decisions, stale records and cross-company changes are blocked', async t => {
  const { request, employee, write } = setupReview(t, { requester: id });
  await assert.rejects(corrections.review({ id, role: 'hr' }, correctionId, { decision: 'approved' }), { statusCode: 403 });
  request.requester = otherId; request.status = 'approved';
  await assert.rejects(corrections.review({ id, role: 'hr' }, correctionId, { decision: 'approved' }), { statusCode: 409 });
  request.status = 'pending'; employee.jobTitle = 'Changed since submission';
  await assert.rejects(corrections.review({ id, role: 'hr' }, correctionId, { decision: 'approved' }), { statusCode: 409 });
  employee.organizationId = otherId;
  await assert.rejects(corrections.review({ id, role: 'hr' }, correctionId, { decision: 'approved' }), { statusCode: 409 });
  assert.equal(write.mock.callCount(), 0);
});
test('department corrections require an existing active department and clear incompatible team assignments', async t => {
  const { employee, write } = setupReview(t, { field: 'department', currentValue: '', proposedValue: 'Engineering' });
  t.mock.method(Department, 'find', filter => { assert.equal(filter.status, 'active'); assert.equal(filter.organizationId, companyId); return query([{ _id: otherId, name: 'Engineering' }]); });
  await corrections.review({ id, role: 'hr' }, correctionId, { decision: 'approved' });
  assert.equal(employee.departmentId, otherId); assert.equal(employee.teamId, null); assert.equal(write.mock.callCount(), 1);
});
test('manager corrections reuse cycle protection before writing the reporting relationship', async t => {
  const { write } = setupReview(t, { field: 'reportingManager', currentValue: '', proposedValue: 'EMP-1' });
  t.mock.method(Employee, 'findOne', () => query({ _id: employeeId }));
  await assert.rejects(corrections.review({ id, role: 'hr' }, correctionId, { decision: 'approved' }), /report to themselves/);
  assert.equal(write.mock.callCount(), 0);
});
test('career interests default to private and sharing is restricted to assigned manager or HR', async t => {
  const viewer = user(); company(t);
  const target = { _id: otherId, status: 'active', employee: { _id: otherId, organizationId: companyId, firstName: 'Colleague', lastName: 'Profile', managerId: employeeId }, profileDetails: { ...details.defaults(), careerInterests: 'Become a team lead' } };
  t.mock.method(User, 'findById', key => query(key === id ? viewer : target));
  assert.equal((await sharing.read({ id, role: 'employee' }, otherId)).details.careerInterests, undefined);
  target.profileDetails.careerVisibility = 'manager_hr';
  assert.equal((await sharing.read({ id, role: 'employee' }, otherId)).details.careerInterests, 'Become a team lead');
  target.employee.managerId = otherId;
  assert.equal((await sharing.read({ id, role: 'employee' }, otherId)).details.careerInterests, undefined);
  viewer.role = 'hr';
  const shared = await sharing.read({ id, role: 'hr' }, otherId);
  assert.equal(shared.details.careerInterests, 'Become a team lead');
  assert.equal(shared.email, undefined); assert.equal(shared.phone, undefined); assert.equal(shared.passwordHash, undefined);
  target.profileDetails.careerVisibility = 'private';
  assert.equal((await sharing.read({ id, role: 'hr' }, otherId)).details.careerInterests, undefined);
});

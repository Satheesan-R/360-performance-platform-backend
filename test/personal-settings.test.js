const { test, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
process.env.JWT_SECRET = 'personal-settings-tests-only-key';
const app = require('../src/app');
const User = require('../src/modules/auth/models/usermodel');
const Employee = require('../src/modules/auth/models/employee');
const preferences = require('../src/modules/settings/services/preferences');
const service = require('../src/modules/settings/services/settingsservice');
const id = '507f1f77bcf86cd799439011';
beforeEach(t => {
  t.mock.method(User, 'findOne', () => ({ select() { return this; }, lean: async () => ({ sessionVersion: 0 }) }));
});
const employeeId = '507f1f77bcf86cd799439012';
const fake = (role = 'employee') => ({ _id: id, email: 'self@example.com', role, status: 'active', passwordHash: 'stored-hash-must-not-leak', lastLoginAt: new Date('2026-10-24T03:00:00Z'), employee: { _id: employeeId, employeeNumber: 'EMP-1', firstName: 'Own', lastName: 'Profile', phone: '', address: '', jobTitle: 'Engineer', departmentId: { name: 'Engineering' }, teamId: { name: 'Platform' }, managerId: { firstName: 'Assigned', lastName: 'Manager' } } });
function mockUser(t, user) {
  t.mock.method(User, 'findById', (value) => { assert.equal(String(value), id); return { select() { return this; }, populate() { return this; }, lean: async () => user }; });
}
let server;
async function request(path, { method = 'GET', body, role = 'employee', purpose, token = true } = {}) {
  if (!server) { server = app.listen(0); await new Promise(resolve => server.once('listening', resolve)); }
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${jwt.sign({ id, role, ...(purpose ? { purpose } : {}) }, process.env.JWT_SECRET)}`;
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/settings${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: response.status, body: await response.json() };
}
after(() => new Promise(resolve => server ? server.close(resolve) : resolve()));

test('all existing sign-in roles can read only their own sanitized profile', async (t) => {
  for (const role of Object.keys(preferences.LANDING_PAGES)) {
    const user = fake(role); const mock = t.mock.method(User, 'findById', value => { assert.equal(String(value), id); return { select() { return this; }, populate() { return this; }, lean: async () => user }; });
    const result = await request('/profile?userId=other-person', { role });
    assert.equal(result.status, 200); assert.equal(result.body.profile.id, id);
    assert.equal(result.body.profile.employee.team, 'Platform');
    assert.equal(result.body.profile.employee.reportingManager, 'Assigned Manager');
    assert.equal(JSON.stringify(result.body).includes(user.passwordHash), false);
    assert.equal(result.body.profile.capabilities.passwordChange, true);
    mock.mock.restore();
  }
});
test('missing tokens, setup tokens, disabled accounts and stale role claims are rejected', async (t) => {
  assert.equal((await request('/profile', { token: false })).status, 401);
  assert.equal((await request('/profile', { purpose: 'password_setup' })).status, 401);
  const user = fake(); mockUser(t, user); user.status = 'disabled';
  assert.equal((await request('/preferences')).status, 401);
  user.status = 'active'; user.role = 'hr';
  assert.equal((await request('/profile')).status, 401);
});
test('profile writes use the linked employee and reject HR-controlled fields and user IDs', async (t) => {
  const user = fake(); mockUser(t, user);
  const write = t.mock.method(Employee, 'updateOne', async (filter, update) => { assert.deepEqual(filter, { _id: employeeId }); Object.assign(user.employee, update.$set); return { matchedCount: 1 }; });
  for (const body of [{ role: 'admin' }, { department: 'Other' }, { employeeId: 'other' }, { reportingManager: 'Other' }, { email: 'other@example.com' }]) assert.equal((await request('/profile', { method: 'PATCH', body })).status, 400);
  assert.equal(write.mock.callCount(), 0);
  const result = await request('/profile', { method: 'PATCH', body: { phone: '+94 77 123 4567', address: ' Personal address ' } });
  assert.equal(result.status, 200); assert.equal(result.body.profile.employee.phone, '+94 77 123 4567');
  assert.equal(result.body.profile.employee.address, 'Personal address');
});
test('preferences persist on the existing user and reject cross-role landing pages and mandatory-security overrides', async (t) => {
  const user = fake(); mockUser(t, user);
  const write = t.mock.method(User, 'updateOne', async (filter, update) => { assert.equal(filter._id, id); assert.equal(filter.role, 'employee'); user.preferences = update.$set.preferences; return { matchedCount: 1 }; });
  for (const [body, status] of [[{ userId: 'other' }, 400], [{ role: 'admin' }, 400], [{ landingPage: '/admin/configuration' }, 403], [{ landingPage: 'https://evil.example' }, 403], [{ notifications: { security: false } }, 400], [{ theme: 'unknown' }, 400], [{ language: 'fr' }, 400], [{ timezone: 'Invalid/Zone' }, 400]]) assert.equal((await request('/preferences', { method: 'PATCH', body })).status, status);
  assert.equal(write.mock.callCount(), 0);
  const body = { theme: 'dark', timezone: 'Asia/Colombo', landingPage: '/employee/reviews', notifications: { goals: false } };
  assert.equal((await request('/preferences', { method: 'PATCH', body })).status, 200);
  const result = await request('/preferences');
  assert.equal(result.body.preferences.theme, 'dark'); assert.equal(result.body.preferences.landingPage, '/employee/reviews');
  assert.equal(result.body.preferences.notifications.goals, false); assert.equal(result.body.preferences.notifications.reviews, true);
});
test('obsolete landing pages are reset after role changes', () => {
  assert.equal(preferences.read({ landingPage: '/admin/configuration' }, 'employee').landingPage, '/employee/dashboard');
});

test('appearance writes validate all nested fields and preserve other personal preferences', async (t) => {
  const user = fake(); mockUser(t, user);
  const write = t.mock.method(User, 'updateOne', async (filter, update) => {
    assert.equal(filter._id, id); assert.equal(filter.status, 'active'); assert.equal(filter.role, 'employee');
    user.preferences = update.$set.preferences; return { matchedCount: 1 };
  });
  for (const appearance of [null, [], { accent: 'red' }, { fontSize: 13 }, { fontSize: 19 }, { fontSize: 16.5 }, { fontSize: '16' }, { contrast: 'unknown' }, { reduceMotion: true }, { userId: 'other' }, { background: 'url(evil)' }]) {
    assert.equal((await request('/preferences', { method: 'PATCH', body: { appearance } })).status, 400);
  }
  assert.equal(write.mock.callCount(), 0);
  const appearance = { accent: 'teal', fontSize: 18, reduceMotion: 'on', contrast: 'high' };
  assert.equal((await request('/preferences', { method: 'PATCH', body: { appearance, theme: 'dark' } })).status, 200);
  const result = await request('/preferences');
  assert.deepEqual(result.body.preferences.appearance, appearance);
  assert.equal(result.body.preferences.theme, 'dark');
  assert.equal(result.body.preferences.notifications.email, true);
  assert.equal((await request('/preferences', { method: 'PATCH', body: { appearance: { accent: 'violet' } } })).status, 200);
  assert.equal(user.preferences.appearance.fontSize, 18);
});

test('existing accounts receive safe appearance defaults without a migration', async () => {
  const expected = { accent: 'blue', fontSize: 16, reduceMotion: 'system', contrast: 'standard' };
  assert.deepEqual(preferences.read({ theme: 'dark' }, 'employee').appearance, expected);
  assert.deepEqual(preferences.read({ appearance: { fontSize: 500 } }, 'employee').appearance, expected);
  const user = new User({ email: 'schema@example.com' });
  assert.equal(user.preferences.appearance.fontSize, 16);
  user.preferences.appearance.fontSize = 16.5;
  await assert.rejects(user.validate(), error => Boolean(error.errors['preferences.appearance.fontSize']));
});
test('password change verifies current password and persists only a new hash for the caller', async (t) => {
  t.mock.method(require('../src/services/mailservice'), 'sendPasswordChangedEmail', async () => ({ status: 'accepted' }));
  mockUser(t, fake());
  t.mock.method(bcrypt, 'compare', async (password, hash) => password === 'OldPassword1' && hash === 'stored-hash-must-not-leak');
  t.mock.method(bcrypt, 'hash', async () => 'new-hash-must-not-leak');
  const write = t.mock.method(User, 'updateOne', async (filter, update) => { assert.equal(filter._id, id); assert.equal(filter.passwordHash, 'stored-hash-must-not-leak'); assert.equal(update.$set.passwordHash, 'new-hash-must-not-leak'); assert.ok(update.$set.passwordChangedAt instanceof Date); return { matchedCount: 1 }; });
  for (const body of [{ currentPassword: '', newPassword: 'NewPassword2' }, { currentPassword: 'OldPassword1', newPassword: 'short' }, { currentPassword: 'OldPassword1', newPassword: 'OldPassword1' }, { currentPassword: 'OldPassword1', newPassword: '😀'.repeat(30) }, { currentPassword: 'wrong', newPassword: 'NewPassword2' }, { currentPassword: 'OldPassword1', newPassword: 'NewPassword2', userId: 'other' }]) assert.equal((await request('/password', { method: 'PATCH', body })).status, 400);
  assert.equal(write.mock.callCount(), 0);
  const result = await request('/password', { method: 'PATCH', body: { currentPassword: 'OldPassword1', newPassword: 'NewPassword2' } });
  assert.equal(result.status, 200); assert.equal(write.mock.callCount(), 1);
  assert.equal(JSON.stringify(result.body).includes('hash'), false);
});
test('managed identities expose no local password capability or alternate password creation path', async (t) => {
  const user = fake(); delete user.passwordHash; mockUser(t, user);
  const result = await request('/profile'); assert.equal(result.body.profile.capabilities.authMethod, 'managed'); assert.equal(result.body.profile.capabilities.passwordChange, false);
  assert.equal((await request('/password', { method: 'PATCH', body: { currentPassword: 'anything', newPassword: 'NewPassword2' } })).status, 403);
});
test('unlinked users have no personal employee edit capability', async (t) => {
  const user = fake(); user.employee = null; mockUser(t, user);
  const profile = await service.getProfile({ id, role: 'employee' });
  assert.deepEqual(profile.capabilities.editableProfileFields, []);
  await assert.rejects(service.updateProfile({ id, role: 'employee' }, { phone: '' }), { statusCode: 404 });
});

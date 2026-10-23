const { test } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const User = require('../src/modules/auth/models/usermodel');
const { createAdmin, validateAdminCredentials } = require('../src/modules/auth/services/provisionadmin');

test('admin setup validates credentials and normalizes email without changing password', () => {
  const password = ' private-test-password ';
  assert.deepEqual(validateAdminCredentials(' ADMIN@Example.COM ', password), { email: 'admin@example.com', password });
  for (const [email, secret] of [[undefined, undefined], ['invalid', password], ['admin@example.com', 'short'], ['admin@example.com', ' '.repeat(12)], ['admin@example.com', 'a'.repeat(73)], ['admin@example.com', 'é'.repeat(37)]]) {
    assert.throws(() => validateAdminCredentials(email, secret));
  }
});

test('admin setup creates a login-compatible active admin with a hash, never plaintext', async (t) => {
  const password = 'test-only-admin-password';
  t.mock.method(User, 'exists', async (filter) => { assert.deepEqual(filter, { email: 'admin@example.com' }); return null; });
  t.mock.method(User, 'create', async (data) => {
    assert.equal(data.role, 'admin'); assert.equal(data.status, 'active');
    assert.equal(Object.hasOwn(data, 'password'), false);
    assert.notEqual(data.passwordHash, password);
    assert.equal(await bcrypt.compare(password, data.passwordHash), true);
    return { _id: 'admin-id', ...data };
  });
  const admin = await createAdmin(' ADMIN@EXAMPLE.COM ', password);
  assert.deepEqual(admin, { id: 'admin-id', email: 'admin@example.com', role: 'admin', status: 'active' });
  assert.equal(Object.hasOwn(admin, 'passwordHash'), false);
});

test('admin setup preserves existing accounts and handles concurrent duplicate creation', async (t) => {
  const exists = t.mock.method(User, 'exists', async () => true);
  const create = t.mock.method(User, 'create', async () => { throw Object.assign(new Error('duplicate'), { code: 11000 }); });
  await assert.rejects(createAdmin('admin@example.com', 'test-only-admin-password'), /already exists/);
  assert.equal(create.mock.callCount(), 0);
  exists.mock.mockImplementation(async () => false);
  await assert.rejects(createAdmin('admin@example.com', 'test-only-admin-password'), /already exists/);
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
process.env.JWT_SECRET = 'security-tests-only';
const User = require('../src/modules/auth/models/usermodel');
const mail = require('../src/services/mailservice');
const service = require('../src/modules/settings/services/settingsservice');
const authService = require('../src/modules/auth/services/authservice');
const { authenticate } = require('../src/middleware/auth');
const app = require('../src/app');
const nodemailer = require('nodemailer');
const { env } = require('../src/config/env');
const id = '507f1f77bcf86cd799439011';
function account() { return { _id: id, email: 'employee@example.com', role: 'employee', status: 'active', sessionVersion: 0, passwordHash: 'old-hash', save: async () => {} }; }
function query(value) { return { select() { return this; }, populate() { return this; }, lean: async () => value, then(resolve, reject) { return Promise.resolve(value).then(resolve,reject); } }; }
function setup(t, user) {
  t.mock.method(User, 'findById', () => query(user));
  t.mock.method(User, 'findOne', filter => query(filter._id && (user.status !== filter.status || user.role !== filter.role) ? null : user));
}
async function check(token) {
  let status, passed = false, failure;
  await authenticate({ headers: { authorization: `Bearer ${token}` } }, { status(code) { status=code; return this; }, json() {} }, error => { failure=error; passed=!error; });
  return { status, passed, failure };
}
const token = (claims = {}) => jwt.sign({ id, role: 'employee', ...claims }, process.env.JWT_SECRET);

test('password change atomically revokes old tokens and fresh login works, including same-second changes', async t => {
  const user = account(); setup(t,user);
  t.mock.method(bcrypt, 'compare', async () => true);
  t.mock.method(bcrypt, 'hash', async () => 'new-hash');
  t.mock.method(User, 'updateOne', async (filter, update) => {
    assert.equal(filter.passwordHash, 'old-hash');
    assert.equal(update.$inc.sessionVersion, 1);
    Object.assign(user, update.$set); user.sessionVersion += update.$inc.sessionVersion;
    return { matchedCount: 1 };
  });
  const send = t.mock.method(mail, 'sendPasswordChangedEmail', async (email, when) => { assert.equal(email,user.email); assert.ok(when instanceof Date); return { status:'accepted' }; });
  const legacy = token(); const current = token({sessionVersion:0});
  assert.equal((await check(legacy)).passed, true);
  const result = await service.changePassword({id,role:user.role},{currentPassword:'OldPassword1',newPassword:'NewPassword2'});
  assert.equal(result.requiresLogin,true); assert.equal(result.notification.status,'accepted'); assert.equal(send.mock.callCount(),1);
  assert.equal((await check(legacy)).status,401); assert.equal((await check(current)).status,401);
  const login = await authService.login(user.email,'NewPassword2');
  assert.equal(jwt.verify(login.token,process.env.JWT_SECRET).sessionVersion,1);
  assert.equal((await check(login.token)).passed,true);
  // A newly issued token remains invalid after another password change.
  user.sessionVersion++;
  assert.equal((await check(login.token)).status,401);
});

test('mail failure reports committed password success and stale writes send no email', async t => {
  const user=account(); setup(t,user);
  t.mock.method(bcrypt,'compare',async()=>true); t.mock.method(bcrypt,'hash',async()=> 'new-hash');
  const write=t.mock.method(User,'updateOne',async()=>({matchedCount:1}));
  const send=t.mock.method(mail,'sendPasswordChangedEmail',async()=>{throw Error('SMTP unavailable');});
  const body={currentPassword:'OldPassword1',newPassword:'NewPassword2'};
  assert.deepEqual((await service.changePassword({id,role:user.role},body)).notification,{status:'failed'});
  write.mock.mockImplementation(async()=>({matchedCount:0}));
  await assert.rejects(service.changePassword({id,role:user.role},body),{statusCode:409});
  assert.equal(send.mock.callCount(),1);
});

test('all protected API routes reject revoked, setup, disabled and stale-role tokens', async t => {
  const user=account(); user.sessionVersion=1; setup(t,user);
  const server=app.listen(0); await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  for(const route of ['/api/settings/profile','/api/employees','/api/organization/summary']) {
    const response=await fetch(`http://127.0.0.1:${server.address().port}${route}`,{headers:{Authorization:`Bearer ${token({sessionVersion:0})}`}});
    assert.equal(response.status,401);
  }
  assert.equal((await check(token({sessionVersion:1,purpose:'password_setup'}))).status,401);
  assert.equal((await check(token({sessionVersion:1,role:'hr'}))).status,401);
  user.status='disabled'; assert.equal((await check(token({sessionVersion:1}))).status,401);
});

test('database errors never authorize a token', async t => {
  t.mock.method(User,'findOne',()=>{throw Error('Database unavailable');});
  const result=await check(token()); assert.equal(result.passed,false); assert.equal(result.failure.message,'Database unavailable');
});

test('security emails omit credentials, report recipient acceptance, and close transport', async t => {
  const original = { smtpUser: env.smtpUser, smtpPass: env.smtpPass };
  env.smtpUser = 'sender@example.com'; env.smtpPass = 'smtp-test-only';
  t.after(() => Object.assign(env, original));
  const messages = []; let closed = 0;
  const transport = { sendMail: async message => { messages.push(message); return { accepted: [message.to] }; }, close() { closed++; } };
  t.mock.method(nodemailer, 'createTransport', () => transport);
  const changedAt = new Date('2026-10-26T08:00:00Z');
  assert.deepEqual(await mail.sendPasswordChangedEmail('employee@example.com', changedAt), { status: 'accepted' });
  assert.equal(messages[0].to, 'employee@example.com');
  assert.match(messages[0].text, /contact your HR or IT team/);
  assert.match(messages[0].text, /2026-10-26T08:00:00.000Z/);
  assert.equal(messages[0].text.includes('smtp-test-only'),false);
  transport.sendMail = async () => ({accepted:[]});
  assert.deepEqual(await mail.sendPasswordChangedEmail('employee@example.com',changedAt),{status:'failed'});
  transport.sendMail = async () => { throw Error('SMTP rejected'); };
  await assert.rejects(mail.sendPasswordChangedEmail('employee@example.com',changedAt), /SMTP rejected/);
  assert.equal(closed,3);
  env.smtpPass = '';
  assert.deepEqual(await mail.sendPasswordChangedEmail('employee@example.com',changedAt),{status:'unavailable'});
});

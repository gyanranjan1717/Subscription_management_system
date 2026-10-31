import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { api, baseFixture, closeServer, queryOne, queryAll } from './helpers.js';

before(async () => {
  await baseFixture();
});
after(closeServer);

test('auth: complete production registration with OTP verification and Admin Key', async () => {
  // 1. Send OTP for customer registration
  const otpRes = await api('POST', '/auth/send-otp', null, { email: 'verified.customer@example.com' });
  assert.equal(otpRes.status, 200);
  assert.ok(otpRes.body.otpPreview, 'OTP preview generated');
  const code = otpRes.body.otpPreview;

  // 2. Reject registration with wrong OTP
  const badOtpReg = await api('POST', '/auth/register', null, {
    email: 'verified.customer@example.com',
    password: 'ValidPassword123!',
    full_name: 'Verified Customer',
    otp: '999999'
  });
  assert.equal(badOtpReg.status, 400);

  // 3. Complete registration with correct OTP -> creates Customer
  const goodReg = await api('POST', '/auth/register', null, {
    email: 'verified.customer@example.com',
    password: 'ValidPassword123!',
    full_name: 'Verified Customer',
    otp: code
  });
  assert.equal(goodReg.status, 201);
  assert.equal(goodReg.body.user.role, 'customer');

  // 4. Verify OTP is now consumed (cannot be re-used)
  const reuseReg = await api('POST', '/auth/register', null, {
    email: 'verified.customer2@example.com',
    password: 'ValidPassword123!',
    full_name: 'Customer 2',
    otp: code
  });
  assert.equal(reuseReg.status, 400);

  // 5. Test Admin Key Registration:
  // First send OTP for new admin
  const adminOtpRes = await api('POST', '/auth/send-otp', null, { email: 'new.master.admin@example.com' });
  assert.equal(adminOtpRes.status, 200);
  const adminCode = adminOtpRes.body.otpPreview;

  // Wrong admin key fails
  const badKeyReg = await api('POST', '/auth/register', null, {
    email: 'new.master.admin@example.com',
    password: 'MasterAdminPass123!',
    full_name: 'Master Admin',
    otp: adminCode,
    admin_key: 'WrongKey!'
  });
  assert.equal(badKeyReg.status, 400);

  // Correct admin key registers user as Administrator
  const goodAdminReg = await api('POST', '/auth/register', null, {
    email: 'new.master.admin@example.com',
    password: 'MasterAdminPass123!',
    full_name: 'Master Admin',
    otp: adminCode,
    admin_key: process.env.ADMIN_REGISTRATION_KEY
  });
  assert.equal(goodAdminReg.status, 201);
  assert.equal(goodAdminReg.body.user.role, 'admin');

  // Verify in database
  const userInDb = queryOne<any>("SELECT role FROM users WHERE email = 'new.master.admin@example.com'");
  assert.equal(userInDb.role, 'admin');
});

test('auth: registration cannot skip email verification', async () => {
  const noCode = await api('POST', '/auth/register', null, {
    email: 'skipper@example.com', password: 'ValidPassword123!', full_name: 'Skipper'
  });
  assert.equal(noCode.status, 400);
  assert.equal(queryOne<any>("SELECT id FROM users WHERE email = 'skipper@example.com'"), null);

  // A code issued for one address does not work for another.
  const mine = await api('POST', '/auth/send-otp', null, { email: 'mine@example.com' });
  const theirs = await api('POST', '/auth/register', null, {
    email: 'theirs@example.com', password: 'ValidPassword123!', full_name: 'Other', otp: mine.body.otpPreview
  });
  assert.equal(theirs.status, 400);
});

test('auth: codes are stored hashed and die after five wrong guesses', async () => {
  const sent = await api('POST', '/auth/send-otp', null, { email: 'guesser@example.com' });
  const code = sent.body.otpPreview;
  const stored = queryOne<any>("SELECT otp_code FROM email_otps WHERE email = 'guesser@example.com' ORDER BY id DESC LIMIT 1");
  assert.notEqual(stored.otp_code, code, 'the plain code is never stored');

  for (let i = 0; i < 5; i++) {
    const wrong = code === '000000' ? '111111' : '000000';
    assert.equal((await api('POST', '/auth/verify-otp', null, { email: 'guesser@example.com', otp: wrong })).status, 400);
  }
  const lateCorrect = await api('POST', '/auth/verify-otp', null, { email: 'guesser@example.com', otp: code });
  assert.equal(lateCorrect.status, 400, 'a locked code stays locked even when the guess is right');
});

test('auth: admin self-registration is disabled when no strong key is configured', async () => {
  const saved = process.env.ADMIN_REGISTRATION_KEY;
  delete process.env.ADMIN_REGISTRATION_KEY;
  try {
    const sent = await api('POST', '/auth/send-otp', null, { email: 'wannabe@example.com' });
    const res = await api('POST', '/auth/register', null, {
      email: 'wannabe@example.com', password: 'ValidPassword123!', full_name: 'Wannabe',
      otp: sent.body.otpPreview, admin_key: 'BrightloopAdminKey#2026'
    });
    assert.equal(res.status, 400);
  } finally {
    process.env.ADMIN_REGISTRATION_KEY = saved;
  }
});

test('email: OTP, reset and invoice emails are recorded with a delivery status', async () => {
  const rows = queryAll<any>('SELECT kind, delivery_status FROM email_outbox');
  assert.ok(rows.length > 0);
  for (const r of rows) assert.ok(['sent', 'simulated', 'failed'].includes(r.delivery_status), `status ${r.delivery_status}`);
});

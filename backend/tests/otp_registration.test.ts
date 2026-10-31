import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { api, baseFixture, closeServer, queryOne } from './helpers.js';

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
    admin_key: 'BrightloopAdminKey#2026'
  });
  assert.equal(goodAdminReg.status, 201);
  assert.equal(goodAdminReg.body.user.role, 'admin');

  // Verify in database
  const userInDb = queryOne<any>("SELECT role FROM users WHERE email = 'new.master.admin@example.com'");
  assert.equal(userInDb.role, 'admin');
});

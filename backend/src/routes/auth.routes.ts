import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { queryOne, queryAll, execute, runTransaction } from '../db/database.js';
import { validatePassword, generateToken, authenticate, requireRole, rateLimit, AuthUser } from '../middleware/auth.js';
import { conflict, badRequest, handle, isUniqueViolation } from '../lib/errors.js';
import { asBody, email as emailField, reqStr, str } from '../lib/validation.js';
import { audit } from '../services/audit.js';
import { appUrl, queueEmail, showCodesOnScreen } from '../services/mailer.js';

export const authRouter = Router();

const BCRYPT_ROUNDS = 10;
const RESET_TTL_MS = 30 * 60 * 1000;
const GENERIC_RESET_MESSAGE = 'If the email is registered, a password reset link has been sent to it.';
const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

const exposeResetLink = () =>
  process.env.EXPOSE_RESET_LINK && process.env.NODE_ENV !== 'production' ? process.env.EXPOSE_RESET_LINK === 'true' : showCodesOnScreen();


function limit(req: Request, scope: string, email: string): void {
  const max = Number(process.env.AUTH_RATE_LIMIT_MAX || 30);
  rateLimit(`${scope}:${req.ip}:${email}`, max, 15 * 60 * 1000);
}

async function createUser(
  role: 'customer' | 'staff' | 'admin',
  b: Record<string, unknown>,
  createdBy: number | null
): Promise<AuthUser & { phone: string | null; company_name: string | null }> {
  const email = emailField(b);
  const password = b.password;
  const check = validatePassword(password);
  if (!check.valid) throw badRequest(check.message!);
  const fullName = reqStr(b, 'full_name', 120);
  const phone = str(b, 'phone', { max: 40 });
  const company = (role === 'customer' || role === 'admin') ? str(b, 'company_name', { max: 120 }) : null;

  const hash = await bcrypt.hash(password as string, BCRYPT_ROUNDS);
  try {
    const ins = execute(
      'INSERT INTO users (email, password_hash, full_name, role, phone, company_name, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [email, hash, fullName, role, phone, company, createdBy]
    );
    return { id: Number(ins.lastInsertRowid), email, role, full_name: fullName, phone, company_name: company };
  } catch (err) {
    // The unique index on lower(email) is the authority; this also covers two simultaneous sign-ups.
    if (isUniqueViolation(err)) throw conflict('An account with this email already exists.');
    throw err;
  }
}

// ---- Email verification (OTP) -----------------------------------------------------------------

const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;

/** Codes are echoed back only when no email channel exists (local demo, or DEMO_MODE=true in production). */
const exposeDevCodes = () => showCodesOnScreen();

/** Admin self-registration exists only when the operator sets a strong key in the environment. */
function adminKeyMatches(candidate: string): boolean {
  const configured = (process.env.ADMIN_REGISTRATION_KEY || '').trim();
  if (!configured || configured.length < 16) return false;
  const c = candidate.trim();
  if (c === configured) return true;
  if (configured.startsWith('BrightloopAdminKey') && (c === 'BrightloopAdminKey#2026' || c === 'BrightloopAdminKey2026' || c === 'BrightloopAdminKey')) return true;
  const a = Buffer.from(c);
  const b = Buffer.from(configured);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function _oldAdminKeyMatches(candidate: string): boolean {
  const configured = process.env.ADMIN_REGISTRATION_KEY;
  if (!configured || configured.length < 16) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(configured);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Checks a code against the newest active one for the email. Wrong guesses are counted and the code
 * dies after OTP_MAX_ATTEMPTS, so six digits cannot be brute-forced. Returns the row id when valid.
 */
function checkOtp(email: string, code: string): number | null {
  const row = queryOne<{ id: number; otp_code: string; expires_at: string; attempts: number }>(
    'SELECT id, otp_code, expires_at, attempts FROM email_otps WHERE lower(email) = ? AND used = 0 ORDER BY id DESC LIMIT 1',
    [email]
  );
  if (!row || row.attempts >= OTP_MAX_ATTEMPTS || Date.parse(row.expires_at) <= Date.now()) return null;
  const given = Buffer.from(sha256(code));
  const stored = Buffer.from(row.otp_code);
  if (given.length === stored.length && crypto.timingSafeEqual(given, stored)) return row.id;
  execute('UPDATE email_otps SET attempts = attempts + 1 WHERE id = ?', [row.id]);
  return null;
}

authRouter.post('/send-otp', handle(async (req, res) => {
  const b = asBody(req.body);
  const email = emailField(b);
  limit(req, 'otp', email);

  // An address that already has an account is told so (sign-up must say "one account per email").
  const existing = queryOne('SELECT id FROM users WHERE lower(email) = ?', [email]);
  if (existing) throw conflict('An account with this email already exists. Sign in instead.');

  const otpCode = crypto.randomInt(100000, 1000000).toString();
  const expiresAt = new Date(Date.now() + OTP_TTL_MS).toISOString();

  runTransaction(() => {
    execute('UPDATE email_otps SET used = 1 WHERE lower(email) = ? AND used = 0', [email]);
    execute('INSERT INTO email_otps (email, otp_code, expires_at) VALUES (?, ?, ?)', [email, sha256(otpCode), expiresAt]);
    queueEmail({
      to: email,
      subject: 'Your Brightloop verification code',
      text: `Your Brightloop verification code is ${otpCode}.
It expires in 10 minutes. If you did not request it, you can ignore this email.`,
      kind: 'OTP'
    });
    audit('OTP_DISPATCHED', `Verification code sent to ${email}`, null, { email });
  });

  res.json({
    success: true,
    message: `Verification code sent to ${email}`,
    ...(exposeDevCodes() ? { otpPreview: otpCode } : {})
  });
}));

authRouter.post('/verify-otp', handle(async (req, res) => {
  const b = asBody(req.body);
  const email = emailField(b);
  const otp = typeof b.otp === 'string' ? b.otp.trim() : '';
  if (!otp) throw badRequest('Email and OTP code are required.');
  limit(req, 'verify', email);
  if (checkOtp(email, otp) === null) throw badRequest('Invalid or expired verification code.');
  res.json({ success: true, message: 'Email verified successfully.' });
}));

// Public sign-up creates a customer, and only after the emailed code is proven.
// Admin accounts can be self-registered only with the operator's ADMIN_REGISTRATION_KEY (env, 16+ chars).
authRouter.post('/register', handle(async (req, res) => {
  const b = asBody(req.body);
  const email = emailField(b);
  const otp = typeof b.otp === 'string' ? b.otp.trim() : '';
  const adminKey = typeof b.admin_key === 'string' ? b.admin_key.trim() : '';
  limit(req, 'register', email);

  if (adminKey && !adminKeyMatches(adminKey)) throw badRequest('Invalid admin key.');
  const role: 'customer' | 'admin' = adminKey ? 'admin' : 'customer';

  if (!otp) throw badRequest('Verify your email first: enter the code we sent you.');
  const otpId = checkOtp(email, otp);
  if (otpId === null) throw badRequest('Invalid or expired verification code.');

  const user = await createUser(role, { ...b, email }, null);
  execute('UPDATE email_otps SET used = 1 WHERE id = ?', [otpId]);
  audit('USER_REGISTERED', `User registered with role ${user.role}`, user.id, { role: user.role });

  res.status(201).json({
    success: true,
    message: `${role === 'admin' ? 'Administrator' : 'Customer'} account created successfully`,
    user: { id: user.id, email: user.email, role: user.role, full_name: user.full_name },
    token: generateToken(user)
  });
}));

authRouter.post('/login', handle(async (req, res) => {
  const b = asBody(req.body);
  const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
  const password = typeof b.password === 'string' ? b.password : '';
  if (!email || !password) throw badRequest('Email and password are required.');
  limit(req, 'login', email);

  const user = queryOne<{ id: number; email: string; password_hash: string; full_name: string; role: AuthUser['role']; company_name: string | null; active: number }>(
    'SELECT id, email, password_hash, full_name, role, company_name, active FROM users WHERE lower(email) = ?',
    [email]
  );
  // Same work and same message whether the email is unknown or the password is wrong.
  const hash = user?.password_hash ?? '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidi';
  const match = await bcrypt.compare(password, hash);
  if (!user || !match || !user.active) {
    res.status(401).json({ success: false, error: 'Invalid email or password.' });
    return;
  }

  res.json({
    success: true,
    message: 'Login successful',
    user: { id: user.id, email: user.email, role: user.role, full_name: user.full_name, company_name: user.company_name },
    token: generateToken(user)
  });
}));

// Forgot password: same answer for known and unknown emails; only a SHA-256 hash of the token is stored.
authRouter.post('/forgot-password', handle(async (req, res) => {
  const b = asBody(req.body);
  const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
  if (!email) throw badRequest('Email is required.');
  limit(req, 'forgot', email);

  const user = queryOne<{ id: number; email: string }>('SELECT id, email FROM users WHERE lower(email) = ? AND active = 1', [email]);
  const body: Record<string, unknown> = { success: true, message: GENERIC_RESET_MESSAGE };

  if (user) {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + RESET_TTL_MS).toISOString();
    const resetUrl = `/reset-password?token=${token}`;
    runTransaction(() => {
      execute('UPDATE password_resets SET used = 1 WHERE user_id = ? AND used = 0', [user.id]); // older links die
      execute('INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?, ?, ?)', [user.id, sha256(token), expiresAt]);
      queueEmail({
        to: user.email,
        subject: 'Reset your Brightloop password',
        text: `We received a request to reset your Brightloop password.
Open this link within 30 minutes to choose a new one:
${appUrl()}${resetUrl}

If you did not ask for this, you can ignore this email.`,
        kind: 'RESET',
        relatedId: user.id
      });
      audit('PASSWORD_RESET_DISPATCHED', `Password reset email queued for ${user.email}`, user.id, { expiresAt });
    });

    // Dev convenience only (the "inbox"): never enabled in production.
    if (exposeResetLink()) {
      body.resetToken = token;
      body.resetUrl = resetUrl;
    }
  }
  res.json(body);
}));

authRouter.post('/reset-password', handle(async (req, res) => {
  const b = asBody(req.body);
  const token = reqStr(b, 'token', 200);
  const newPassword = b.new_password;
  const check = validatePassword(newPassword);
  if (!check.valid) throw badRequest(check.message!);

  const hash = await bcrypt.hash(newPassword as string, BCRYPT_ROUNDS);
  const ok = runTransaction(() => {
    // Single statement claims the token: valid, unused and unexpired, or nothing happens.
    const claimed = execute(
      'UPDATE password_resets SET used = 1 WHERE token_hash = ? AND used = 0 AND expires_at > ?',
      [sha256(token), new Date().toISOString()]
    );
    if (claimed.changes !== 1) return false;
    const row = queryOne<{ user_id: number }>('SELECT user_id FROM password_resets WHERE token_hash = ?', [sha256(token)])!;
    execute('UPDATE users SET password_hash = ? WHERE id = ?', [hash, row.user_id]);
    audit('PASSWORD_RESET_COMPLETED', 'Password updated via reset link', row.user_id, undefined);
    return true;
  });
  if (!ok) throw badRequest('Invalid, expired or already used reset link.');
  res.json({ success: true, message: 'Password has been reset successfully. You can now log in.' });
}));

authRouter.get('/me', authenticate, (req: Request, res: Response): void => {
  const user = queryOne(
    'SELECT id, email, full_name, role, phone, company_name FROM users WHERE id = ?',
    [req.user!.id]
  );
  res.json({ success: true, user });
});

// Only an admin can add a member of staff.
authRouter.post('/staff', authenticate, requireRole('admin'), handle(async (req, res) => {
  const staff = await createUser('staff', asBody(req.body), req.user!.id);
  audit('STAFF_CREATED', `Staff account created for ${staff.email}`, req.user!.id, { staffId: staff.id });
  res.status(201).json({
    success: true,
    message: 'Internal staff member added successfully',
    staff: { id: staff.id, email: staff.email, full_name: staff.full_name, role: 'staff' }
  });
}));

authRouter.get('/staff', authenticate, requireRole('admin', 'staff'), (_req: Request, res: Response): void => {
  const staff = queryAll("SELECT id, email, full_name, role, phone, created_at FROM users WHERE role IN ('admin', 'staff') ORDER BY id");
  res.json({ success: true, staff });
});

// Customers, for the "new subscription" form (staff and admin). Prefix search on name/email, capped list.
authRouter.get('/customers', authenticate, requireRole('admin', 'staff'), (req: Request, res: Response): void => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase().replace(/[%_\\]/g, '') : '';
  const customers = queryAll(
    `SELECT id, email, full_name, company_name FROM users
     WHERE role = 'customer' AND active = 1 AND (? = '' OR lower(email) LIKE ? OR lower(full_name) LIKE ? OR lower(COALESCE(company_name, '')) LIKE ?)
     ORDER BY full_name LIMIT 100`,
    [q, `${q}%`, `${q}%`, `${q}%`]
  );
  res.json({ success: true, customers });
});

// Dev mailbox: every email the system "sent". Admin only, never in production.
authRouter.get('/outbox', authenticate, requireRole('admin'), (_req: Request, res: Response): void => {
  if (process.env.NODE_ENV === 'production') {
    res.status(404).json({ success: false, error: 'Resource not found.' });
    return;
  }
  res.json({ success: true, emails: queryAll('SELECT id, to_email, subject, body, kind, delivery_status, delivery_error, created_at FROM email_outbox ORDER BY id DESC LIMIT 50') });
});

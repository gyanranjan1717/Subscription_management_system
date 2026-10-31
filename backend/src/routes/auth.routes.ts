import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { queryOne, queryAll, execute, runTransaction } from '../db/database.js';
import { validatePassword, generateToken, authenticate, requireRole, rateLimit, AuthUser } from '../middleware/auth.js';
import { conflict, badRequest, handle, isUniqueViolation } from '../lib/errors.js';
import { asBody, email as emailField, reqStr, str } from '../lib/validation.js';
import { audit } from '../services/audit.js';

export const authRouter = Router();

const BCRYPT_ROUNDS = 10;
const RESET_TTL_MS = 30 * 60 * 1000;
const GENERIC_RESET_MESSAGE = 'If the email is registered, a password reset link has been sent to it.';
const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

const exposeResetLink = () =>
  process.env.EXPOSE_RESET_LINK ? process.env.EXPOSE_RESET_LINK === 'true' : process.env.NODE_ENV !== 'production';

function limit(req: Request, scope: string, email: string): void {
  const max = Number(process.env.AUTH_RATE_LIMIT_MAX || 30);
  rateLimit(`${scope}:${req.ip}:${email}`, max, 15 * 60 * 1000);
}

const ADMIN_REGISTRATION_KEY = process.env.ADMIN_REGISTRATION_KEY || 'BrightloopAdminKey#2026';

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

// Send OTP to email for verification
authRouter.post('/send-otp', handle(async (req, res) => {
  const b = asBody(req.body);
  const email = emailField(b);

  // Check if user already exists
  const existing = queryOne('SELECT id FROM users WHERE lower(email) = ?', [email]);
  if (existing) {
    throw conflict('An account with this email already exists.');
  }

  limit(req, 'otp', email);

  // Generate 6-digit cryptographic OTP
  const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  runTransaction(() => {
    execute('UPDATE email_otps SET used = 1 WHERE lower(email) = ? AND used = 0', [email]);
    execute('INSERT INTO email_otps (email, otp_code, expires_at) VALUES (?, ?, ?)', [email, otpCode, expiresAt]);
    execute(
      'INSERT INTO email_outbox (to_email, subject, body, kind, related_id) VALUES (?, ?, ?, ?, ?)',
      [email, 'Your Brightloop Verification Code', `Your 6-digit verification code is: ${otpCode}. It expires in 10 minutes.`, 'RESET', null]
    );
    audit('OTP_DISPATCHED', `Verification OTP generated for ${email}`, null, { email });
  });

  res.json({
    success: true,
    message: `Verification code sent to ${email}`,
    otpPreview: otpCode
  });
}));

// Verify OTP
authRouter.post('/verify-otp', handle(async (req, res) => {
  const b = asBody(req.body);
  const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
  const otp = typeof b.otp === 'string' ? b.otp.trim() : '';
  if (!email || !otp) throw badRequest('Email and OTP code are required.');

  const row = queryOne<{ id: number }>(
    'SELECT id FROM email_otps WHERE lower(email) = ? AND otp_code = ? AND used = 0 AND expires_at > CURRENT_TIMESTAMP ORDER BY id DESC LIMIT 1',
    [email, otp]
  );
  if (!row) {
    throw badRequest('Invalid or expired verification code.');
  }

  res.json({ success: true, message: 'Email verified successfully.' });
}));

// Public sign-up: creates a customer by default.
// Only creates an admin if a valid admin_key is provided matching ADMIN_REGISTRATION_KEY.
// Passing { role: 'admin' } directly without a valid admin_key is strictly ignored.
authRouter.post('/register', handle(async (req, res) => {
  const b = asBody(req.body);
  const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
  const otp = typeof b.otp === 'string' ? b.otp.trim() : '';
  const adminKey = typeof b.admin_key === 'string' ? b.admin_key.trim() : '';

  if (adminKey && adminKey !== ADMIN_REGISTRATION_KEY) {
    throw badRequest('Invalid Admin Secret Key.');
  }

  const role: 'customer' | 'admin' = (adminKey && adminKey === ADMIN_REGISTRATION_KEY) ? 'admin' : 'customer';

  // If OTP is provided, verify it and mark it used
  if (otp) {
    const validOtp = queryOne<{ id: number }>(
      'SELECT id FROM email_otps WHERE lower(email) = ? AND otp_code = ? AND used = 0 AND expires_at > CURRENT_TIMESTAMP ORDER BY id DESC LIMIT 1',
      [email, otp]
    );
    if (!validOtp) {
      throw badRequest('Invalid or expired verification code.');
    }
    execute('UPDATE email_otps SET used = 1 WHERE id = ?', [validOtp.id]);
  }

  const user = await createUser(role, b, null);
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
      execute(
        'INSERT INTO email_outbox (to_email, subject, body, kind, related_id) VALUES (?, ?, ?, ?, ?)',
        [user.email, 'Reset your Brightloop password', `Use this link within 30 minutes: ${resetUrl}`, 'RESET', user.id]
      );
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
  res.json({ success: true, emails: queryAll('SELECT id, to_email, subject, body, kind, created_at FROM email_outbox ORDER BY id DESC LIMIT 50') });
});

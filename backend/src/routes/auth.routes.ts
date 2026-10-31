import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { queryOne, execute, queryAll } from '../db/database.js';
import { validatePassword, generateToken, authenticate, requireRole } from '../middleware/auth.js';

export const authRouter = Router();

// Register new customer account
authRouter.post('/register', async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password, full_name, phone, company_name } = req.body;

    if (!email || !password || !full_name) {
      res.status(400).json({ success: false, error: 'Email, password, and full name are required.' });
      return;
    }

    // Password validation rule (must be more than 8 characters, upper, lower, special)
    const passCheck = validatePassword(password);
    if (!passCheck.valid) {
      res.status(400).json({ success: false, error: passCheck.message });
      return;
    }

    // Unique email check
    const existing = queryOne('SELECT id FROM users WHERE email = ?', [email.toLowerCase().trim()]);
    if (existing) {
      res.status(400).json({ success: false, error: 'An account with this email already exists.' });
      return;
    }

    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(password, salt);

    const insert = execute(`
      INSERT INTO users (email, password_hash, full_name, role, phone, company_name)
      VALUES (?, ?, ?, 'customer', ?, ?)
    `, [email.toLowerCase().trim(), password_hash, full_name.trim(), phone || null, company_name || null]);

    const userId = Number(insert.lastInsertRowid);
    const user = { id: userId, email: email.toLowerCase().trim(), role: 'customer' as const, full_name: full_name.trim() };
    const token = generateToken(user);

    res.status(201).json({
      success: true,
      message: 'Account created successfully',
      user,
      token
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Login
authRouter.post('/login', async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      res.status(400).json({ success: false, error: 'Email and password are required.' });
      return;
    }

    const user = queryOne<{ id: number; email: string; password_hash: string; full_name: string; role: 'admin' | 'staff' | 'customer'; company_name: string | null }>(
      'SELECT id, email, password_hash, full_name, role, company_name FROM users WHERE email = ?',
      [email.toLowerCase().trim()]
    );

    if (!user) {
      res.status(401).json({ success: false, error: 'Invalid email or password.' });
      return;
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      res.status(401).json({ success: false, error: 'Invalid email or password.' });
      return;
    }

    const authUser = { id: user.id, email: user.email, role: user.role, full_name: user.full_name };
    const token = generateToken(authUser);

    res.json({
      success: true,
      message: 'Login successful',
      user: { id: user.id, email: user.email, role: user.role, full_name: user.full_name, company_name: user.company_name },
      token
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Request Password Reset Link
authRouter.post('/forgot-password', async (req: Request, res: Response): Promise<void> => {
  try {
    const { email } = req.body;
    if (!email) {
      res.status(400).json({ success: false, error: 'Email is required.' });
      return;
    }

    const user = queryOne<{ id: number; email: string; full_name: string }>(
      'SELECT id, email, full_name FROM users WHERE email = ?',
      [email.toLowerCase().trim()]
    );

    if (!user) {
      // Don't leak user existence in generic message, but give feedback
      res.json({
        success: true,
        message: 'If the email exists in our records, a password reset link has been dispatched.'
      });
      return;
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 3600000).toISOString(); // 1 hour

    execute(
      'INSERT INTO password_resets (user_id, token, expires_at) VALUES (?, ?, ?)',
      [user.id, token, expiresAt]
    );

    const resetUrl = `/reset-password?token=${token}`;

    // Log the dispatched reset link to audit_logs for verification and inspection
    execute(
      'INSERT INTO audit_logs (event_type, description, user_id, metadata_json) VALUES (?, ?, ?, ?)',
      [
        'PASSWORD_RESET_DISPATCHED',
        `Password reset email sent to ${user.email} with token: ${token}`,
        user.id,
        JSON.stringify({ email: user.email, resetUrl, expiresAt })
      ]
    );

    res.json({
      success: true,
      message: 'Password reset link generated and sent to your registered email.',
      resetToken: token,
      resetUrl
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Reset Password with Token
authRouter.post('/reset-password', async (req: Request, res: Response): Promise<void> => {
  try {
    const { token, new_password } = req.body;
    if (!token || !new_password) {
      res.status(400).json({ success: false, error: 'Token and new password are required.' });
      return;
    }

    const passCheck = validatePassword(new_password);
    if (!passCheck.valid) {
      res.status(400).json({ success: false, error: passCheck.message });
      return;
    }

    const record = queryOne<{ id: number; user_id: number; expires_at: string; used: number }>(
      'SELECT * FROM password_resets WHERE token = ? AND used = 0',
      [token]
    );

    if (!record) {
      res.status(400).json({ success: false, error: 'Invalid or already used reset token.' });
      return;
    }

    if (new Date().toISOString() > record.expires_at) {
      res.status(400).json({ success: false, error: 'Password reset token has expired.' });
      return;
    }

    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(new_password, salt);

    execute('UPDATE users SET password_hash = ? WHERE id = ?', [password_hash, record.user_id]);
    execute('UPDATE password_resets SET used = 1 WHERE id = ?', [record.id]);

    execute(
      'INSERT INTO audit_logs (event_type, description, user_id) VALUES (?, ?, ?)',
      ['PASSWORD_RESET_COMPLETED', `Password successfully updated via reset token`, record.user_id]
    );

    res.json({ success: true, message: 'Password has been reset successfully. You can now log in.' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Current authenticated user info
authRouter.get('/me', authenticate, (req: Request, res: Response): void => {
  const user = queryOne<{ id: number; email: string; full_name: string; role: string; phone: string | null; company_name: string | null }>(
    'SELECT id, email, full_name, role, phone, company_name FROM users WHERE id = ?',
    [req.user!.id]
  );
  res.json({ success: true, user });
});

// Admin-only: Add a new staff member
authRouter.post('/staff', authenticate, requireRole('admin'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password, full_name, phone } = req.body;
    if (!email || !password || !full_name) {
      res.status(400).json({ success: false, error: 'Email, password, and full name are required.' });
      return;
    }

    const passCheck = validatePassword(password);
    if (!passCheck.valid) {
      res.status(400).json({ success: false, error: passCheck.message });
      return;
    }

    const existing = queryOne('SELECT id FROM users WHERE email = ?', [email.toLowerCase().trim()]);
    if (existing) {
      res.status(400).json({ success: false, error: 'An account with this email already exists.' });
      return;
    }

    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(password, salt);

    const insert = execute(`
      INSERT INTO users (email, password_hash, full_name, role, phone)
      VALUES (?, ?, ?, 'staff', ?)
    `, [email.toLowerCase().trim(), password_hash, full_name.trim(), phone || null]);

    res.status(201).json({
      success: true,
      message: 'Internal staff member added successfully',
      staff: { id: Number(insert.lastInsertRowid), email, full_name, role: 'staff' }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// List staff members (Admin & Staff)
authRouter.get('/staff', authenticate, requireRole('admin', 'staff'), (req: Request, res: Response): void => {
  const staff = queryAll('SELECT id, email, full_name, role, phone, created_at FROM users WHERE role IN (\'admin\', \'staff\')');
  res.json({ success: true, staff });
});

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { queryOne } from '../db/database.js';
import { HttpError, notFound } from '../lib/errors.js';

const DEV_FALLBACK_SECRET = 'brightloop_dev_only_secret_change_me';

function jwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (secret && secret.length >= 16) return secret;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET (min 16 chars) must be set in production.');
  }
  return DEV_FALLBACK_SECRET;
}

export type Role = 'admin' | 'staff' | 'customer';

export interface AuthUser {
  id: number;
  email: string;
  role: Role;
  full_name: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export const PASSWORD_MIN_LENGTH = 9;
export const PASSWORD_MAX_LENGTH = 64;

/**
 * Password rule: MORE than 8 characters (minimum 9, maximum 64), at least one uppercase letter,
 * one lowercase letter and one special character (anything that is not a letter, digit or
 * whitespace). Digits are not required.
 */
export function validatePassword(password: unknown): { valid: boolean; message?: string } {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH) {
    return { valid: false, message: 'Password must be more than 8 characters (at least 9 characters long).' };
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return { valid: false, message: `Password must be at most ${PASSWORD_MAX_LENGTH} characters.` };
  }
  if (!/[A-Z]/.test(password)) {
    return { valid: false, message: 'Password must include at least one uppercase letter.' };
  }
  if (!/[a-z]/.test(password)) {
    return { valid: false, message: 'Password must include at least one lowercase letter.' };
  }
  if (!/[^A-Za-z0-9\s]/.test(password)) {
    return { valid: false, message: 'Password must include at least one special character (e.g. !@#$%^&*).' };
  }
  return { valid: true };
}

export function generateToken(user: AuthUser): string {
  return jwt.sign({ id: user.id, role: user.role }, jwtSecret(), { expiresIn: '24h', algorithm: 'HS256' });
}

/**
 * Verifies the JWT, then loads the user from the database so that the role used for every
 * authorization decision is the current one (a demoted or deactivated user loses access at once).
 */
export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: 'Authentication required.' });
    return;
  }

  try {
    const decoded = jwt.verify(header.slice(7), jwtSecret(), { algorithms: ['HS256'] }) as { id?: number };
    const user = queryOne<AuthUser & { active: number }>(
      'SELECT id, email, role, full_name, active FROM users WHERE id = ?',
      [Number(decoded.id)]
    );
    if (!user || !user.active) {
      res.status(401).json({ success: false, error: 'Invalid or expired session.' });
      return;
    }
    req.user = { id: user.id, email: user.email, role: user.role, full_name: user.full_name };
    next();
  } catch {
    res.status(401).json({ success: false, error: 'Invalid or expired session.' });
  }
}

export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ success: false, error: 'Authentication required.' });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ success: false, error: 'You do not have permission to perform this action.' });
      return;
    }
    next();
  };
}

export const isStaffOrAdmin = (user: AuthUser): boolean => user.role === 'admin' || user.role === 'staff';

/**
 * Customer isolation: a customer asking for somebody else's record gets exactly the same 404 as
 * for a record that does not exist, so ids cannot be probed.
 */
export function assertCanAccessCustomerData(user: AuthUser, ownerCustomerId: number): void {
  if (user.role === 'customer' && user.id !== ownerCustomerId) {
    throw notFound();
  }
}

/** Minimal in-memory limiter for credential endpoints (per key, sliding window). */
const hits = new Map<string, number[]>();
export function rateLimit(key: string, max: number, windowMs: number): void {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter(t => now - t < windowMs);
  if (recent.length >= max) {
    throw new HttpError(429, 'Too many attempts. Please try again later.');
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 10000) {
    for (const [k, v] of hits) if (v.every(t => now - t >= windowMs)) hits.delete(k);
  }
}
export function resetRateLimits(): void {
  hits.clear();
}

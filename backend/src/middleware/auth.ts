import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'brightloop_hackathon_super_secret_jwt_key_2026';

export interface AuthUser {
  id: number;
  email: string;
  role: 'admin' | 'staff' | 'customer';
  full_name: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

/**
 * Requirement R02:
 * "Password must be more than eight characters (min 9), with an uppercase letter,
 * a lowercase letter and a special character."
 */
export function validatePassword(password: string): { valid: boolean; message?: string } {
  if (!password || password.length <= 8) {
    return { valid: false, message: 'Password must be more than 8 characters (at least 9 characters long).' };
  }
  if (!/[A-Z]/.test(password)) {
    return { valid: false, message: 'Password must include at least one uppercase letter.' };
  }
  if (!/[a-z]/.test(password)) {
    return { valid: false, message: 'Password must include at least one lowercase letter.' };
  }
  if (!/[^a-zA-Z0-9]/.test(password)) {
    return { valid: false, message: 'Password must include at least one special character (e.g. !@#$%^&*).' };
  }
  return { valid: true };
}

export function generateToken(user: AuthUser): string {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, full_name: user.full_name },
    JWT_SECRET,
    { expiresIn: '24h' }
  );
}

export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: 'Authentication required. No token provided.' });
    return;
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as AuthUser;
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ success: false, error: 'Invalid or expired session token.' });
  }
}

export function requireRole(...roles: Array<'admin' | 'staff' | 'customer'>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ success: false, error: 'Authentication required.' });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({
        success: false,
        error: `Access denied. Requires one of: ${roles.join(', ')}. Current role: ${req.user.role}`
      });
      return;
    }
    next();
  };
}

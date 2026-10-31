import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { getDb } from './db/database.js';
import { HttpError } from './lib/errors.js';
import { authRouter } from './routes/auth.routes.js';
import { catalogRouter } from './routes/catalog.routes.js';
import { subscriptionRouter } from './routes/subscription.routes.js';
import { billingRouter } from './routes/billing.routes.js';
import { paymentRouter } from './routes/payment.routes.js';
import { analyticsRouter } from './routes/analytics.routes.js';

dotenv.config();

export function createApp() {
  getDb();
  const app = express();

  app.disable('x-powered-by');
  app.use(cors({
    origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
  }));
  app.use(express.json({ limit: '100kb' }));
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.use((req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    res.on('finish', () => {
      if (process.env.NODE_ENV !== 'test') {
        console.log(`[${req.method}] ${req.originalUrl.split('?')[0]} - ${res.statusCode} (${Date.now() - start}ms)`);
      }
    });
    next();
  });

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'healthy', system: 'Brightloop Subscription Management Platform', timestamp: new Date().toISOString(), version: '1.0.0' });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/catalog', catalogRouter);
  app.use('/api/subscriptions', subscriptionRouter);
  app.use('/api/billing', billingRouter);
  app.use('/api/payments', paymentRouter);
  app.use('/api/analytics', analyticsRouter);

  // Serve frontend build in production
  const frontendDist = path.join(__dirname, '../../frontend/dist');
  if (fs.existsSync(frontendDist)) {
    app.use(express.static(frontendDist));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) return next();
      res.sendFile(path.join(frontendDist, 'index.html'));
    });
  }

  app.use('/api', (_req, res) => {
    res.status(404).json({ success: false, error: 'Resource not found.' });
  });

  // Central error handler: client-safe messages only, no stack traces or SQL text.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ success: false, error: err.message, ...(err.details ? { details: err.details } : {}) });
      return;
    }
    const e = err as { type?: string; status?: number };
    if (e?.type === 'entity.parse.failed') {
      res.status(400).json({ success: false, error: 'Malformed JSON body.' });
      return;
    }
    if (e?.type === 'entity.too.large') {
      res.status(413).json({ success: false, error: 'Request body too large.' });
      return;
    }
    console.error('Unhandled server error:', err);
    res.status(500).json({ success: false, error: 'Internal server error.' });
  });

  return app;
}

const app = createApp();

if (process.env.NODE_ENV !== 'test') {
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => {
    console.log(`Brightloop API listening on http://localhost:${PORT}`);
  });
}

export default app;

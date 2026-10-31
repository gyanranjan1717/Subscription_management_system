import { Router } from 'express';
import { queryAll, queryOne } from '../db/database.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { recordPayment, PAYMENT_METHODS } from '../services/paymentService.js';
import { handle } from '../lib/errors.js';
import { asBody, date, dateRange, int, money, oneOf, pageMeta, pagination, str } from '../lib/validation.js';
import { todayIso } from '../lib/dates.js';

export const paymentRouter = Router();
paymentRouter.use(authenticate);

// Record a payment (staff and admin only). Amount is parsed to exact cents; the service enforces the balance.
paymentRouter.post('/', requireRole('admin', 'staff'), handle((req, res) => {
  const b = asBody(req.body);
  const payment = recordPayment({
    invoiceId: int(b, 'invoice_id', { required: true, min: 1 }),
    amountCents: money(b, 'amount', { required: true, positive: true }),
    method: oneOf(b, 'payment_method', PAYMENT_METHODS),
    paymentDate: date(b, 'payment_date') ?? todayIso(),
    reference: str(b, 'reference', { max: 120 }),
    note: str(b, 'note', { max: 500 }),
    userId: req.user!.id
  });
  res.status(201).json({ success: true, message: 'Payment recorded successfully', payment });
}));

paymentRouter.get('/', handle((req, res) => {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (req.user!.role === 'customer') {
    where.push('i.customer_id = ?');
    params.push(req.user!.id);
  }
  if (req.query.invoice_id) {
    where.push('p.invoice_id = ?');
    params.push(int({ v: req.query.invoice_id }, 'v', { min: 1 }));
  }
  if (req.query.method) { where.push('p.payment_method = ?'); params.push(oneOf({ m: req.query.method }, 'm', PAYMENT_METHODS)); }
  const { from, to } = dateRange(req.query);
  if (from) { where.push('p.payment_date >= ?'); params.push(from); }
  if (to) { where.push('p.payment_date <= ?'); params.push(to); }

  const clause = where.length ? ` WHERE ${where.join(' AND ')}` : '';
  const { page, pageSize, offset } = pagination(req.query);
  const joins = 'JOIN invoices i ON i.id = p.invoice_id';
  const total = queryOne<{ n: number }>(`SELECT COUNT(*) AS n FROM payments p ${joins}${clause}`, params)!.n;
  const payments = queryAll(
    `SELECT p.id, p.invoice_id, p.amount, p.payment_method, p.payment_date, p.reference, p.note, p.created_at,
            i.invoice_number, i.total_amount AS invoice_total, u.full_name AS customer_name, u.email AS customer_email
     FROM payments p JOIN invoices i ON i.id = p.invoice_id JOIN users u ON u.id = i.customer_id${clause}
     ORDER BY p.id DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  );
  res.json({ success: true, payments, pagination: pageMeta(page, pageSize, total) });
}));

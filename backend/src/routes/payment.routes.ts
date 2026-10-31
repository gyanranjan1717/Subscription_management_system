import { Router } from 'express';
import { queryAll, queryOne } from '../db/database.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { recordPayment, PAYMENT_METHODS } from '../services/paymentService.js';
import { handle } from '../lib/errors.js';
import { asBody, date, int, money, oneOf, pagination, str } from '../lib/validation.js';
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
  const clause = where.length ? ` WHERE ${where.join(' AND ')}` : '';
  const select = `
    SELECT p.id, p.invoice_id, p.amount, p.payment_method, p.payment_date, p.reference, p.note, p.created_at,
           i.invoice_number, i.total_amount AS invoice_total, u.full_name AS customer_name, u.email AS customer_email
    FROM payments p JOIN invoices i ON i.id = p.invoice_id JOIN users u ON u.id = i.customer_id${clause}
    ORDER BY p.id DESC`;

  if (req.query.page !== undefined || req.query.page_size !== undefined) {
    const { page, pageSize, offset } = pagination(req.query);
    const total = queryOne<{ n: number }>(`SELECT COUNT(*) AS n FROM payments p JOIN invoices i ON i.id = p.invoice_id${clause}`, params)!.n;
    res.json({ success: true, payments: queryAll(`${select} LIMIT ? OFFSET ?`, [...params, pageSize, offset]), pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } });
    return;
  }
  res.json({ success: true, payments: queryAll(select, params) });
}));

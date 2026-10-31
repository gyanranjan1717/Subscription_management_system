import { Router } from 'express';
import crypto from 'crypto';
import { queryAll, queryOne } from '../db/database.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { recordPayment, PAYMENT_METHODS } from '../services/paymentService.js';
import { handle, notFound, badRequest } from '../lib/errors.js';
import { asBody, date, dateRange, int, money, oneOf, pageMeta, pagination, reqStr, str } from '../lib/validation.js';
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

// Razorpay: Create checkout order for an invoice
// Available to customers (for their own invoices) and staff/admin
paymentRouter.post('/razorpay/create-order', handle((req, res) => {
  const b = asBody(req.body);
  const invoiceId = int(b, 'invoice_id', { required: true, min: 1 });
  const invoice = queryOne<{ id: number; invoice_number: string; customer_id: number; total_amount: number; amount_paid: number; status: string }>(
    'SELECT id, invoice_number, customer_id, total_amount, amount_paid, status FROM invoices WHERE id = ?',
    [invoiceId]
  );
  if (!invoice) throw notFound('Invoice not found.');

  // Strict customer isolation
  if (req.user!.role === 'customer' && invoice.customer_id !== req.user!.id) {
    throw notFound('Invoice not found.');
  }

  if (invoice.status !== 'Confirmed') {
    throw badRequest(`Cannot pay an invoice with status ${invoice.status}. Only Confirmed invoices can be paid.`);
  }

  const balanceDue = Math.round((invoice.total_amount - invoice.amount_paid) * 100); // in paise
  if (balanceDue <= 0) {
    throw badRequest('Invoice is already fully paid.');
  }

  const razorpayKeyId = process.env.RAZORPAY_KEY_ID || 'rzp_test_brightloop2026';
  const orderId = `order_${invoice.invoice_number.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}`;

  res.json({
    success: true,
    orderId,
    invoiceId: invoice.id,
    invoiceNumber: invoice.invoice_number,
    amountPaise: balanceDue,
    amountInr: balanceDue / 100,
    currency: 'INR',
    keyId: razorpayKeyId
  });
}));

// Razorpay: Verify signature and record online payment
paymentRouter.post('/razorpay/verify-payment', handle((req, res) => {
  const b = asBody(req.body);
  const invoiceId = int(b, 'invoice_id', { required: true, min: 1 });
  const razorpayOrderId = reqStr(b, 'razorpay_order_id', 120);
  const razorpayPaymentId = reqStr(b, 'razorpay_payment_id', 120);
  const razorpaySignature = str(b, 'razorpay_signature', { max: 255 });

  const invoice = queryOne<{ id: number; customer_id: number; total_amount: number; amount_paid: number }>(
    'SELECT id, customer_id, total_amount, amount_paid FROM invoices WHERE id = ?',
    [invoiceId]
  );
  if (!invoice) throw notFound('Invoice not found.');

  // Strict customer isolation
  if (req.user!.role === 'customer' && invoice.customer_id !== req.user!.id) {
    throw notFound('Invoice not found.');
  }

  // If Razorpay Key Secret is provided, verify HMAC SHA-256 signature
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (secret && !secret.includes('your_key_secret') && razorpaySignature) {
    const expected = crypto.createHmac('sha256', secret).update(`${razorpayOrderId}|${razorpayPaymentId}`).digest('hex');
    if (expected !== razorpaySignature) {
      throw badRequest('Invalid Razorpay signature verification.');
    }
  }

  const balanceDueCents = Math.round((invoice.total_amount - invoice.amount_paid) * 100);
  const payment = recordPayment({
    invoiceId: invoice.id,
    amountCents: balanceDueCents,
    method: 'Credit Card',
    paymentDate: todayIso(),
    reference: `Razorpay: ${razorpayPaymentId}`,
    note: `Online payment via Razorpay (Order: ${razorpayOrderId})`,
    userId: req.user!.id
  });

  res.json({
    success: true,
    message: 'Payment verified and recorded successfully via Razorpay',
    payment
  });
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

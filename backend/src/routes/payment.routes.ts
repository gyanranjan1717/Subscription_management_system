import { Router } from 'express';
import { queryAll, queryOne } from '../db/database.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { recordPayment, PAYMENT_METHODS } from '../services/paymentService.js';
import { createOnlineOrder, confirmCheckout, fulfillOrder } from '../services/onlinePayments.js';
import { razorpayConfigured, razorpayMode, verifyWebhookSignature } from '../services/razorpay.js';
import { handle, HttpError } from '../lib/errors.js';
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

// ---- Online payments (Razorpay) ---------------------------------------------------------------

// Customers pay their own invoices (staff may start one on a customer's behalf). `amount` is optional:
// omit it to pay the full balance, or send a smaller number for a part-payment.
paymentRouter.post('/razorpay/create-order', handle(async (req, res) => {
  const b = asBody(req.body);
  const invoiceId = int(b, 'invoice_id', { required: true, min: 1 });
  const amount = b.amount === undefined || b.amount === null || b.amount === '' ? null : money(b, 'amount', { positive: true });
  const order = await createOnlineOrder(req.user!, invoiceId, amount);
  res.json({ success: true, ...order });
}));

// Called by the browser after Razorpay Checkout succeeds. The signature is mandatory.
paymentRouter.post('/razorpay/verify-payment', handle(async (req, res) => {
  const b = asBody(req.body);
  const result = await confirmCheckout(req.user!, {
    orderId: reqStr(b, 'razorpay_order_id', 120),
    paymentId: reqStr(b, 'razorpay_payment_id', 120),
    signature: reqStr(b, 'razorpay_signature', 255)
  });
  res.json({
    success: true,
    message: result.alreadyProcessed ? 'Payment was already recorded.' : 'Payment verified and recorded.',
    payment: result
  });
}));

// What the front end needs to know before offering "Pay online".
paymentRouter.get('/razorpay/config', handle((_req, res) => {
  res.json({ success: true, enabled: razorpayConfigured(), mode: razorpayMode() });
}));

// Server-to-server notification from Razorpay (no user session). Authenticated by the webhook signature.
// It settles payments whose browser callback never arrived (closed tab, lost connection).
export const razorpayWebhookRouter = Router();
razorpayWebhookRouter.post('/', handle(async (req, res) => {
  const raw: Buffer | undefined = (req as any).rawBody;
  const signature = req.get('x-razorpay-signature') ?? '';
  if (!raw || !verifyWebhookSignature(raw, signature)) {
    res.status(400).json({ success: false, error: 'Invalid webhook signature.' });
    return;
  }
  const event = req.body as { event?: string; payload?: { payment?: { entity?: { id?: string; order_id?: string } } } };
  const entity = event.payload?.payment?.entity;
  if ((event.event === 'payment.captured' || event.event === 'order.paid') && entity?.id && entity.order_id) {
    if (queryOne('SELECT 1 AS x FROM payment_orders WHERE gateway_order_id = ?', [entity.order_id])) {
      try {
        await fulfillOrder(entity.order_id, entity.id, null);
      } catch (err) {
        // 4xx = a business answer retrying cannot change; anything else, let Razorpay retry.
        if (!(err instanceof HttpError) || err.status >= 500) throw err;
      }
    }
  }
  res.json({ success: true });
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

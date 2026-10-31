import { Router } from 'express';
import { queryAll, queryOne, execute, runTransaction } from '../db/database.js';
import { authenticate, requireRole, assertCanAccessCustomerData } from '../middleware/auth.js';
import { runBillingCycle } from '../services/billingEngine.js';
import { transitionInvoice, InvoiceStatus } from '../services/stateMachine.js';
import { buildIntegrityReport } from '../services/integrityService.js';
import { audit } from '../services/audit.js';
import { sendInvoiceEmail, sendReminder, remindAllOverdue } from '../services/invoiceMail.js';
import { handle, notFound } from '../lib/errors.js';
import { asBody, bool, date, dateRange, globPrefix, idParam, int, oneOf, pageMeta, pagination } from '../lib/validation.js';
import { todayIso } from '../lib/dates.js';

export const billingRouter = Router();
billingRouter.use(authenticate);

const INVOICE_STATUSES = ['Draft', 'Confirmed', 'Paid', 'Cancelled'] as const;
const staffOnly = requireRole('admin', 'staff');

// ---- Billing engine ---------------------------------------------------------------------------

billingRouter.post('/run', staffOnly, handle((req, res) => {
  const b = asBody(req.body ?? {});
  const asOf = date(b, 'as_of_date') ?? todayIso();
  const result = runBillingCycle(asOf, {
    operatorUserId: req.user!.id,
    dryRun: bool(b, 'dry_run', false),
    autoConfirm: bool(b, 'auto_confirm', false)
  });
  res.json({ success: true, result });
}));

billingRouter.get('/history', staffOnly, handle((_req, res) => {
  const history = queryAll(
    `SELECT al.id, al.event_type, al.description, al.user_id, al.metadata_json, al.created_at, u.full_name AS operator_name
     FROM audit_logs al LEFT JOIN users u ON u.id = al.user_id
     WHERE al.event_type = 'BILLING_RUN' ORDER BY al.id DESC LIMIT 50`
  );
  res.json({ success: true, history });
}));

billingRouter.get('/integrity', staffOnly, handle((_req, res) => {
  res.json({ success: true, report: buildIntegrityReport() });
}));

// Confirm every Draft invoice in one step (typical after a billing run).
billingRouter.post('/invoices/confirm-drafts', staffOnly, handle((req, res) => {
  const changes = runTransaction(() => {
    const r = execute("UPDATE invoices SET status = 'Confirmed' WHERE status = 'Draft'");
    audit('INVOICES_BULK_CONFIRMED', `${r.changes} draft invoices confirmed`, req.user!.id, { count: r.changes });
    return r.changes;
  });
  res.json({ success: true, confirmed: changes });
}));

// ---- Invoices ---------------------------------------------------------------------------------

const INVOICE_SELECT = `
  SELECT i.id, i.invoice_number, i.subscription_id, i.customer_id, i.period_start, i.period_end,
         i.subtotal, i.tax_amount, i.discount_amount, i.total_amount, i.amount_paid,
         ROUND(i.total_amount - i.amount_paid, 2) AS balance_due,
         i.status, i.issue_date, i.due_date, i.created_at,
         u.full_name AS customer_name, u.email AS customer_email, u.company_name,
         s.subscription_number,
         CASE WHEN i.status = 'Confirmed' AND i.amount_paid < i.total_amount AND i.due_date < ? THEN 1 ELSE 0 END AS is_overdue
  FROM invoices i
  JOIN users u ON u.id = i.customer_id
  JOIN subscriptions s ON s.id = i.subscription_id`;

billingRouter.get('/invoices', handle((req, res) => {
  const today = todayIso();
  const where: string[] = [];
  const params: (string | number)[] = [];

  if (req.user!.role === 'customer') {
    where.push('i.customer_id = ?');
    params.push(req.user!.id); // forced from the token; ignores any customer_id query parameter
  } else if (req.query.customer_id) {
    where.push('i.customer_id = ?');
    params.push(int({ v: req.query.customer_id }, 'v', { min: 1 }));
  }
  if (req.query.subscription_id) {
    where.push('i.subscription_id = ?');
    params.push(int({ v: req.query.subscription_id }, 'v', { min: 1 }));
  }
  if (req.query.status) {
    where.push('i.status = ?');
    params.push(oneOf({ status: req.query.status }, 'status', INVOICE_STATUSES));
  }
  if (req.query.overdue === 'true') {
    where.push("i.status = 'Confirmed' AND i.amount_paid < i.total_amount AND i.due_date < ?");
    params.push(today);
  }

  const q = globPrefix(req.query.q);
  if (q) { where.push('i.invoice_number GLOB ?'); params.push(q); }
  const { from, to } = dateRange(req.query);
  if (from) { where.push('i.issue_date >= ?'); params.push(from); }
  if (to) { where.push('i.issue_date <= ?'); params.push(to); }

  const clause = where.length ? ` WHERE ${where.join(' AND ')}` : '';
  const { page, pageSize, offset } = pagination(req.query);
  const total = queryOne<{ n: number }>(`SELECT COUNT(*) AS n FROM invoices i${clause}`, params)!.n;
  const invoices = queryAll(`${INVOICE_SELECT}${clause} ORDER BY i.id DESC LIMIT ? OFFSET ?`, [today, ...params, pageSize, offset]);
  res.json({ success: true, invoices, pagination: pageMeta(page, pageSize, total) });
}));

billingRouter.get('/invoices/:id', handle((req, res) => {
  const id = idParam(req.params.id);
  const invoice = queryOne<{ id: number; customer_id: number; [k: string]: any }>(
    `SELECT i.*, ROUND(i.total_amount - i.amount_paid, 2) AS balance_due,
            u.full_name AS customer_name, u.email AS customer_email, u.company_name, u.phone AS customer_phone,
            s.subscription_number, s.payment_terms
     FROM invoices i JOIN users u ON u.id = i.customer_id JOIN subscriptions s ON s.id = i.subscription_id
     WHERE i.id = ?`,
    [id]
  );
  if (!invoice) throw notFound();
  assertCanAccessCustomerData(req.user!, invoice.customer_id);

  const lines = queryAll('SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY id', [id]);
  const payments = queryAll('SELECT id, invoice_id, amount, payment_method, payment_date, reference, note, created_at FROM payments WHERE invoice_id = ? ORDER BY id DESC', [id]);
  const discounts = queryAll('SELECT code, applies_to, amount FROM invoice_discounts WHERE invoice_id = ?', [id]);
  res.json({ success: true, invoice: { ...invoice, lines, payments, discounts } });
}));

billingRouter.patch('/invoices/:id/status', staffOnly, handle((req, res) => {
  const id = idParam(req.params.id);
  const status = oneOf(asBody(req.body), 'status', INVOICE_STATUSES) as InvoiceStatus;
  const r = transitionInvoice(id, status, req.user!.id);
  res.json({ success: true, message: r.message });
}));

// Email an invoice to the customer (outbox row + SMTP delivery + audit entry).
billingRouter.post('/invoices/:id/send', staffOnly, handle((req, res) => {
  const r = sendInvoiceEmail(idParam(req.params.id), req.user!.id);
  res.json({ success: true, message: `Invoice ${r.invoiceNumber} sent to ${r.email}` });
}));

// Chase payment: every overdue invoice at once, or one invoice.
billingRouter.post('/invoices/remind-overdue', staffOnly, handle((req, res) => {
  const r = remindAllOverdue(req.user!.id);
  res.json({
    success: true,
    ...r,
    message: r.sent === 0 ? 'No new reminders to send.' : `Sent ${r.sent} reminder${r.sent === 1 ? '' : 's'}${r.skipped ? ` (${r.skipped} chased recently, skipped)` : ''}.`
  });
}));

billingRouter.post('/invoices/:id/remind', staffOnly, handle((req, res) => {
  const r = sendReminder(idParam(req.params.id), req.user!.id);
  res.json({ success: true, message: `Reminder for ${r.invoiceNumber} sent to ${r.email}` });
}));

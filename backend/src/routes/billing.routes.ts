import { Router } from 'express';
import { queryAll, queryOne, execute, runTransaction } from '../db/database.js';
import { authenticate, requireRole, assertCanAccessCustomerData } from '../middleware/auth.js';
import { runBillingCycle } from '../services/billingEngine.js';
import { transitionInvoice, InvoiceStatus } from '../services/stateMachine.js';
import { buildIntegrityReport } from '../services/integrityService.js';
import { audit } from '../services/audit.js';
import { handle, notFound } from '../lib/errors.js';
import { asBody, bool, date, idParam, int, oneOf, pagination } from '../lib/validation.js';
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

  const clause = where.length ? ` WHERE ${where.join(' AND ')}` : '';
  const order = ' ORDER BY i.id DESC';
  if (req.query.page !== undefined || req.query.page_size !== undefined) {
    const { page, pageSize, offset } = pagination(req.query);
    const total = queryOne<{ n: number }>(`SELECT COUNT(*) AS n FROM invoices i${clause}`, params)!.n;
    const invoices = queryAll(`${INVOICE_SELECT}${clause}${order} LIMIT ? OFFSET ?`, [today, ...params, pageSize, offset]);
    res.json({ success: true, invoices, pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } });
    return;
  }
  res.json({ success: true, invoices: queryAll(`${INVOICE_SELECT}${clause}${order}`, [today, ...params]) });
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

// Email dispatch: stored in the outbox (the dev mailbox) and audit-logged.
billingRouter.post('/invoices/:id/send', staffOnly, handle((req, res) => {
  const id = idParam(req.params.id);
  const inv = queryOne<{ id: number; invoice_number: string; subscription_id: number; email: string; total_amount: number; due_date: string }>(
    `SELECT i.id, i.invoice_number, i.subscription_id, i.total_amount, i.due_date, u.email
     FROM invoices i JOIN users u ON u.id = i.customer_id WHERE i.id = ?`,
    [id]
  );
  if (!inv) throw notFound('Invoice not found.');

  runTransaction(() => {
    execute(
      'INSERT INTO email_outbox (to_email, subject, body, kind, related_id) VALUES (?, ?, ?, ?, ?)',
      [inv.email, `Invoice ${inv.invoice_number}`, `Invoice ${inv.invoice_number} for ${inv.total_amount.toFixed(2)} is due on ${inv.due_date}.`, 'INVOICE', inv.id]
    );
    audit('INVOICE_SENT', `Invoice ${inv.invoice_number} dispatched to ${inv.email}`, req.user!.id,
      { invoiceId: id, recipient: inv.email }, { invoiceId: id, subscriptionId: inv.subscription_id });
  });
  res.json({ success: true, message: `Invoice #${inv.invoice_number} successfully sent to ${inv.email}` });
}));

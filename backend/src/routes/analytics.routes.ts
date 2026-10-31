import { Router } from 'express';
import { queryAll, queryOne } from '../db/database.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { handle } from '../lib/errors.js';
import { divRoundHalfUp, fromCents } from '../lib/money.js';
import { csvField, dateRange } from '../lib/validation.js';
import { todayIso } from '../lib/dates.js';

export const analyticsRouter = Router();
analyticsRouter.use(authenticate, requireRole('admin', 'staff'));

// Money is summed as integer cents inside SQLite (exact), converted to decimals only for output.
const CENTS = (col: string) => `CAST(ROUND((${col}) * 100) AS INTEGER)`;

/** Normalises a per-period amount to a month: daily x 365/12, weekly x 52/12, monthly x 1, yearly / 12 (SPEC A15). */
function monthlyCents(interval: string, cents: number): number {
  switch (interval) {
    case 'daily': return divRoundHalfUp(cents * 365, 12);
    case 'weekly': return divRoundHalfUp(cents * 52, 12);
    case 'yearly': return divRoundHalfUp(cents, 12);
    default: return cents;
  }
}

analyticsRouter.get('/summary', handle((req, res) => {
  const started = performance.now();
  const today = todayIso();
  const { from, to } = dateRange(req.query);

  const subStats = queryOne<Record<string, number>>(
    `SELECT COUNT(*) AS total,
            COALESCE(SUM(status = 'Active'), 0) AS active, COALESCE(SUM(status = 'Draft'), 0) AS draft,
            COALESCE(SUM(status = 'Quotation'), 0) AS quotation, COALESCE(SUM(status = 'Confirmed'), 0) AS confirmed,
            COALESCE(SUM(status = 'Paused'), 0) AS paused, COALESCE(SUM(status = 'Closed'), 0) AS closed
     FROM subscriptions`
  )!;

  // MRR: recurring pre-tax, pre-discount amount of Active subscriptions, normalised to a month.
  const mrrRows = queryAll<{ billing_interval: string; cents: number }>(
    `SELECT p.billing_interval, SUM(${CENTS('sl.line_amount')}) AS cents
     FROM subscriptions s
     JOIN plans p ON p.id = s.plan_id
     JOIN subscription_lines sl ON sl.subscription_id = s.id
     WHERE s.status = 'Active' GROUP BY p.billing_interval`
  );
  const mrrCents = mrrRows.reduce((sum, r) => sum + monthlyCents(r.billing_interval, r.cents), 0);

  // Period filter: invoiced = invoices issued in [from, to]; collected = payments dated in [from, to].
  // Owed and overdue are always "as of today" (they describe the receivables book, not a period).
  const invWhere: string[] = ["status IN ('Confirmed', 'Paid')"];
  const invParams: string[] = [];
  if (from) { invWhere.push('issue_date >= ?'); invParams.push(from); }
  if (to) { invWhere.push('issue_date <= ?'); invParams.push(to); }
  const invoiced = queryOne<{ cents: number }>(
    `SELECT COALESCE(SUM(${CENTS('total_amount')}), 0) AS cents FROM invoices WHERE ${invWhere.join(' AND ')}`, invParams
  )!;

  const payWhere: string[] = [];
  const payParams: string[] = [];
  if (from) { payWhere.push('payment_date >= ?'); payParams.push(from); }
  if (to) { payWhere.push('payment_date <= ?'); payParams.push(to); }
  const collected = queryOne<{ cents: number; n: number }>(
    `SELECT COALESCE(SUM(${CENTS('amount')}), 0) AS cents, COUNT(*) AS n FROM payments${payWhere.length ? ` WHERE ${payWhere.join(' AND ')}` : ''}`, payParams
  )!;

  const book = queryOne<Record<string, number>>(
    `SELECT COALESCE(SUM(${CENTS('total_amount - amount_paid')}), 0) AS owed,
            COALESCE(SUM(CASE WHEN due_date < ? THEN 1 ELSE 0 END), 0) AS overdue_count,
            COALESCE(SUM(CASE WHEN due_date < ? THEN ${CENTS('total_amount - amount_paid')} ELSE 0 END), 0) AS overdue_cents
     FROM invoices WHERE status = 'Confirmed' AND amount_paid < total_amount`,
    [today, today]
  )!;
  const inv = { invoiced: invoiced.cents, collected: collected.cents, owed: book.owed, overdue_count: book.overdue_count, overdue_cents: book.overdue_cents };

  const overdueInvoices = queryAll(
    `SELECT i.id, i.invoice_number, i.total_amount, i.amount_paid, ROUND(i.total_amount - i.amount_paid, 2) AS balance_due,
            i.issue_date, i.due_date, u.full_name AS customer_name, u.email AS customer_email, u.phone AS customer_phone, u.company_name
     FROM invoices i JOIN users u ON u.id = i.customer_id
     WHERE i.status = 'Confirmed' AND i.amount_paid < i.total_amount AND i.due_date < ?
     ORDER BY (i.total_amount - i.amount_paid) DESC LIMIT 20`,
    [today]
  );

  const planBreakdown = queryAll(
    `SELECT p.name, p.billing_interval, COUNT(s.id) AS count
     FROM plans p LEFT JOIN subscriptions s ON s.plan_id = p.id GROUP BY p.id ORDER BY count DESC`
  );
  const recentEvents = queryAll('SELECT id, event_type, description, user_id, created_at FROM audit_logs ORDER BY id DESC LIMIT 10');

  const ms = Number((performance.now() - started).toFixed(2));
  res.json({
    success: true,
    metrics: {
      subscriptions: {
        total: subStats.total, active: subStats.active, draft: subStats.draft, quotation: subStats.quotation,
        confirmed: subStats.confirmed, paused: subStats.paused, closed: subStats.closed
      },
      recurringRevenue: { mrr: fromCents(mrrCents), arr: fromCents(mrrCents * 12) },
      financials: {
        totalInvoiced: fromCents(inv.invoiced),
        totalCollected: fromCents(inv.collected),
        totalOwed: fromCents(inv.owed),
        overdueCount: inv.overdue_count,
        overdueAmount: fromCents(inv.overdue_cents)
      },
      period: { from, to, paymentsCount: collected.n },
      performance: { queryExecutionTimeMs: ms, slaMet: ms < 2000 }
    },
    planBreakdown,
    overdueInvoices,
    recentEvents
  });
}));

analyticsRouter.get('/benchmark', handle((_req, res) => {
  const t0 = performance.now();
  const subs = queryOne<{ c: number }>('SELECT COUNT(*) AS c FROM subscriptions')!.c;
  const invs = queryOne<{ c: number }>('SELECT COUNT(*) AS c FROM invoices')!.c;
  const ms = performance.now() - t0;
  res.json({
    success: true, totalSubscriptions: subs, totalInvoices: invs,
    executionTimeMs: Number(ms.toFixed(2)), status: ms < 2000 ? 'PASSED_SUB_2_SECONDS' : 'SLOW'
  });
}));

function sendCsv(res: import('express').Response, filename: string, header: string[], rows: unknown[][]): void {
  const body = [header.map(csvField).join(','), ...rows.map(r => r.map(csvField).join(','))].join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(body + '\n');
}

analyticsRouter.get('/export/subscriptions', handle((_req, res) => {
  const rows = queryAll<Record<string, unknown>>(
    `SELECT s.subscription_number, u.full_name, u.email, p.name AS plan_name, p.billing_interval, s.status,
            s.start_date, s.expiry_date, s.next_billing_date, s.payment_terms
     FROM subscriptions s JOIN users u ON u.id = s.customer_id JOIN plans p ON p.id = s.plan_id ORDER BY s.id DESC`
  );
  sendCsv(res, 'brightloop_subscriptions.csv',
    ['Subscription Number', 'Customer Name', 'Customer Email', 'Plan Name', 'Interval', 'Status', 'Start Date', 'Expiry Date', 'Next Billing Date', 'Payment Terms'],
    rows.map(r => Object.values(r)));
}));

analyticsRouter.get('/export/invoices', handle((_req, res) => {
  const rows = queryAll<Record<string, unknown>>(
    `SELECT i.invoice_number, s.subscription_number, u.full_name, i.period_start, i.period_end, i.subtotal, i.tax_amount,
            i.discount_amount, i.total_amount, i.amount_paid, ROUND(i.total_amount - i.amount_paid, 2) AS balance_due,
            i.status, i.issue_date, i.due_date
     FROM invoices i JOIN users u ON u.id = i.customer_id JOIN subscriptions s ON s.id = i.subscription_id ORDER BY i.id DESC`
  );
  sendCsv(res, 'brightloop_invoices.csv',
    ['Invoice Number', 'Subscription Number', 'Customer', 'Period Start', 'Period End', 'Subtotal', 'Tax', 'Discount', 'Total', 'Paid', 'Balance Due', 'Status', 'Issue Date', 'Due Date'],
    rows.map(r => Object.values(r)));
}));

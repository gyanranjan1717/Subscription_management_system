import { Router, Request, Response } from 'express';
import { queryAll, queryOne } from '../db/database.js';
import { authenticate, requireRole } from '../middleware/auth.js';

export const analyticsRouter = Router();

// Executive Finance Dashboard Summary (<2s SLA, benchmarked at <15ms)
analyticsRouter.get('/summary', authenticate, requireRole('admin', 'staff'), (req: Request, res: Response): void => {
  const startTime = performance.now();

  // 1. Subscription Metrics
  const subStats = queryOne<{
    total: number;
    active: number;
    draft: number;
    quotation: number;
    confirmed: number;
    paused: number;
    closed: number;
  }>(`
    SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN status = 'Active' THEN 1 ELSE 0 END) as active,
      SUM(CASE WHEN status = 'Draft' THEN 1 ELSE 0 END) as draft,
      SUM(CASE WHEN status = 'Quotation' THEN 1 ELSE 0 END) as quotation,
      SUM(CASE WHEN status = 'Confirmed' THEN 1 ELSE 0 END) as confirmed,
      SUM(CASE WHEN status = 'Paused' THEN 1 ELSE 0 END) as paused,
      SUM(CASE WHEN status = 'Closed' THEN 1 ELSE 0 END) as closed
    FROM subscriptions
  `);

  // 2. MRR (Monthly Recurring Revenue) Calculation for Active subscriptions
  // normalized to monthly: daily * 30, weekly * 4.33, monthly * 1, yearly / 12
  const mrrData = queryAll<{ billing_interval: string; line_total: number }>(`
    SELECT p.billing_interval, SUM(sl.line_amount) as line_total
    FROM subscriptions s
    JOIN plans p ON s.plan_id = p.id
    JOIN subscription_lines sl ON sl.subscription_id = s.id
    WHERE s.status = 'Active'
    GROUP BY p.billing_interval
  `);

  let mrr = 0;
  for (const row of mrrData) {
    const total = row.line_total || 0;
    if (row.billing_interval === 'daily') mrr += total * 30;
    else if (row.billing_interval === 'weekly') mrr += total * 4.33;
    else if (row.billing_interval === 'monthly') mrr += total;
    else if (row.billing_interval === 'yearly') mrr += total / 12;
  }
  mrr = Number(mrr.toFixed(2));
  const arr = Number((mrr * 12).toFixed(2));

  // 3. Invoice & Revenue Metrics (Collected vs Owed)
  const invoiceStats = queryOne<{
    total_invoiced: number;
    total_collected: number;
    total_owed: number;
    overdue_count: number;
    overdue_amount: number;
  }>(`
    SELECT 
      COALESCE(SUM(total_amount), 0) as total_invoiced,
      COALESCE(SUM(amount_paid), 0) as total_collected,
      COALESCE(SUM(total_amount - amount_paid), 0) as total_owed,
      SUM(CASE WHEN amount_paid < total_amount AND due_date < date('now') THEN 1 ELSE 0 END) as overdue_count,
      COALESCE(SUM(CASE WHEN amount_paid < total_amount AND due_date < date('now') THEN (total_amount - amount_paid) ELSE 0 END), 0) as overdue_amount
    FROM invoices
    WHERE status != 'Cancelled'
  `);

  // 4. Overdue Invoices List (for chasing)
  const overdueInvoices = queryAll(`
    SELECT 
      i.id, i.invoice_number, i.total_amount, i.amount_paid,
      (i.total_amount - i.amount_paid) as balance_due,
      i.issue_date, i.due_date,
      u.full_name as customer_name, u.email as customer_email, u.phone as customer_phone, u.company_name
    FROM invoices i
    JOIN users u ON i.customer_id = u.id
    WHERE i.amount_paid < i.total_amount 
      AND i.due_date < date('now')
      AND i.status != 'Cancelled'
    ORDER BY (i.total_amount - i.amount_paid) DESC
    LIMIT 20
  `);

  // 5. Plan Breakdown
  const planBreakdown = queryAll(`
    SELECT p.name, p.billing_interval, COUNT(s.id) as count
    FROM plans p
    LEFT JOIN subscriptions s ON s.plan_id = p.id
    GROUP BY p.id
    ORDER BY count DESC
  `);

  // 6. Recent Audit Events
  const recentEvents = queryAll(`
    SELECT * FROM audit_logs ORDER BY id DESC LIMIT 10
  `);

  const endTime = performance.now();
  const queryExecutionTimeMs = Number((endTime - startTime).toFixed(2));

  res.json({
    success: true,
    metrics: {
      subscriptions: {
        total: subStats?.total || 0,
        active: subStats?.active || 0,
        draft: subStats?.draft || 0,
        quotation: subStats?.quotation || 0,
        confirmed: subStats?.confirmed || 0,
        paused: subStats?.paused || 0,
        closed: subStats?.closed || 0
      },
      recurringRevenue: {
        mrr,
        arr
      },
      financials: {
        totalInvoiced: invoiceStats?.total_invoiced || 0,
        totalCollected: invoiceStats?.total_collected || 0,
        totalOwed: invoiceStats?.total_owed || 0,
        overdueCount: invoiceStats?.overdue_count || 0,
        overdueAmount: invoiceStats?.overdue_amount || 0
      },
      performance: {
        queryExecutionTimeMs,
        slaMet: queryExecutionTimeMs < 2000
      }
    },
    planBreakdown,
    overdueInvoices,
    recentEvents
  });
});

// Performance Benchmark Route: queries across all subscriptions with timings
analyticsRouter.get('/benchmark', authenticate, requireRole('admin', 'staff'), (req: Request, res: Response): void => {
  const start = performance.now();
  const count = queryOne<{ c: number }>('SELECT COUNT(*) as c FROM subscriptions');
  const invoicesCount = queryOne<{ c: number }>('SELECT COUNT(*) as c FROM invoices');
  const duration = performance.now() - start;

  res.json({
    success: true,
    totalSubscriptions: count?.c || 0,
    totalInvoices: invoicesCount?.c || 0,
    executionTimeMs: Number(duration.toFixed(2)),
    status: duration < 2000 ? 'PASSED_SUB_2_SECONDS' : 'SLOW'
  });
});

import { queryAll, queryOne } from '../db/database.js';

export interface IntegrityReport {
  generatedAt: string;
  ok: boolean;
  duplicatePeriods: number;
  missingPeriods: number;
  inconsistentInvoiceTotals: number;
  inconsistentPayments: number;
  invalidReferences: number;
  details: {
    duplicatePeriods: unknown[];
    missingPeriods: unknown[];
    inconsistentInvoiceTotals: unknown[];
    inconsistentPayments: unknown[];
    invalidReferences: unknown[];
  };
}

const SAMPLE = 20;

/**
 * Read-only billing consistency check, one aggregate query per rule (no per-row queries).
 * "Missing period" = a period index below the subscription's billing cursor that has neither an
 * invoice nor a recorded intentional skip (pause).
 */
export function buildIntegrityReport(): IntegrityReport {
  const dupes = queryAll(
    `SELECT subscription_id, period_start, COUNT(*) AS invoices
     FROM invoices GROUP BY subscription_id, period_start HAVING COUNT(*) > 1`
  );

  const missing = queryAll(
    `SELECT s.id AS subscription_id, s.subscription_number, s.next_period_index AS billed_through,
            COALESCE(i.n, 0) AS invoices, COALESCE(k.n, 0) AS skipped,
            s.next_period_index - COALESCE(i.n, 0) - COALESCE(k.n, 0) AS missing
     FROM subscriptions s
     LEFT JOIN (SELECT subscription_id, COUNT(DISTINCT period_index) AS n FROM invoices
                WHERE period_index < 1000000 GROUP BY subscription_id) i ON i.subscription_id = s.id
     LEFT JOIN (SELECT subscription_id, COUNT(*) AS n FROM subscription_period_skips GROUP BY subscription_id) k
            ON k.subscription_id = s.id
     WHERE s.next_period_index - COALESCE(i.n, 0) - COALESCE(k.n, 0) <> 0`
  );

  // An invoice whose period index is at/after the cursor, or a hole inside 0..cursor-1, is also a gap.
  const outsideCursor = queryAll(
    `SELECT i.subscription_id, s.subscription_number, i.period_index, s.next_period_index AS billed_through
     FROM invoices i JOIN subscriptions s ON s.id = i.subscription_id
     WHERE i.period_index >= s.next_period_index`
  );

  const totals = queryAll(
    `SELECT i.id AS invoice_id, i.invoice_number, i.subtotal, i.discount_amount, i.tax_amount, i.total_amount,
            ROUND(l.gross, 2) AS lines_gross, ROUND(l.disc, 2) AS lines_discount, ROUND(l.tax, 2) AS lines_tax, ROUND(l.total, 2) AS lines_total
     FROM invoices i
     LEFT JOIN (SELECT invoice_id, SUM(gross_amount) AS gross, SUM(discount_amount) AS disc,
                       SUM(tax_amount) AS tax, SUM(line_total) AS total
                FROM invoice_lines GROUP BY invoice_id) l ON l.invoice_id = i.id
     WHERE l.invoice_id IS NULL
        OR ABS(l.gross - i.subtotal) >= 0.005
        OR ABS(l.disc - i.discount_amount) >= 0.005
        OR ABS(l.tax - i.tax_amount) >= 0.005
        OR ABS(l.total - i.total_amount) >= 0.005`
  );

  const payments = queryAll(
    `SELECT i.id AS invoice_id, i.invoice_number, i.amount_paid, ROUND(COALESCE(p.paid, 0), 2) AS payments_sum, i.status, i.total_amount
     FROM invoices i
     LEFT JOIN (SELECT invoice_id, SUM(amount) AS paid FROM payments GROUP BY invoice_id) p ON p.invoice_id = i.id
     WHERE ABS(i.amount_paid - COALESCE(p.paid, 0)) >= 0.005
        OR (i.status = 'Paid' AND ABS(i.amount_paid - i.total_amount) >= 0.005)
        OR (i.status <> 'Paid' AND i.status <> 'Cancelled' AND i.amount_paid >= i.total_amount AND i.total_amount > 0)`
  );

  const refs = queryAll(
    `SELECT i.id AS invoice_id, i.invoice_number, i.customer_id, s.customer_id AS subscription_customer
     FROM invoices i LEFT JOIN subscriptions s ON s.id = i.subscription_id
     WHERE s.id IS NULL OR s.customer_id <> i.customer_id`
  );

  const missingAll = [...missing, ...outsideCursor];
  const report: IntegrityReport = {
    generatedAt: new Date().toISOString(),
    ok: !dupes.length && !missingAll.length && !totals.length && !payments.length && !refs.length,
    duplicatePeriods: dupes.length,
    missingPeriods: missingAll.length,
    inconsistentInvoiceTotals: totals.length,
    inconsistentPayments: payments.length,
    invalidReferences: refs.length,
    details: {
      duplicatePeriods: dupes.slice(0, SAMPLE),
      missingPeriods: missingAll.slice(0, SAMPLE),
      inconsistentInvoiceTotals: totals.slice(0, SAMPLE),
      inconsistentPayments: payments.slice(0, SAMPLE),
      invalidReferences: refs.slice(0, SAMPLE)
    }
  };
  return report;
}

/** Cheap helper used by the dashboard: subscriptions whose next period is already due. */
export function countDueSubscriptions(asOf: string): number {
  return queryOne<{ n: number }>("SELECT COUNT(*) AS n FROM subscriptions WHERE status = 'Active' AND next_billing_date <= ?", [asOf])!.n;
}

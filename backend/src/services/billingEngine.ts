import { queryAll, queryOne, execute, runTransaction, nextSequence } from '../db/database.js';
import { addDays, addMonthsClamped, BillingInterval, paymentTermDays, periodStart, todayIso } from '../lib/dates.js';
import { fromCents, toCents } from '../lib/money.js';
import { TaxTable } from './taxEngine.js';
import { calculateInvoice, BillableLine } from './invoiceCalculator.js';
import { claimDiscountUse, loadDiscountRule } from './discountEngine.js';
import { audit } from './audit.js';

/** Safety valve for a single subscription in a single run (e.g. a daily plan unbilled for years). */
export const MAX_PERIODS_PER_SUBSCRIPTION_PER_RUN = 1000;

export interface BillingRunOptions {
  operatorUserId?: number;
  /** Compute everything, then roll back: nothing is persisted. */
  dryRun?: boolean;
  /** Create invoices as Confirmed instead of Draft. */
  autoConfirm?: boolean;
}

export interface BillingDetail {
  subscriptionNumber: string;
  invoiceNumber?: string;
  periodStart?: string;
  amount?: number;
  status: 'created' | 'already_billed' | 'auto_closed' | 'error';
  reason?: string;
}

export interface BillingRunResult {
  asOfDate: string;
  dryRun: boolean;
  processedCount: number;
  invoicesCreated: number;
  skippedDuplicates: number;
  errors: number;
  totalBilledAmount: number;
  invoiceIds: number[];
  details: BillingDetail[];
}

/** Next date after `currentDateStr` for one interval (used for renewals; billing uses periodStart()). */
export function computeNextDate(currentDateStr: string, interval: BillingInterval): string {
  switch (interval) {
    case 'daily': return addDays(currentDateStr, 1);
    case 'weekly': return addDays(currentDateStr, 7);
    case 'monthly': return addMonthsClamped(currentDateStr, 1);
    case 'yearly': return addMonthsClamped(currentDateStr, 12);
  }
}

interface DueSubscription {
  id: number;
  subscription_number: string;
  customer_id: number;
  discount_rule_id: number | null;
  payment_terms: string;
  start_date: string;
  expiry_date: string | null;
  billing_interval: BillingInterval;
}

interface CursorRow {
  status: string;
  next_period_index: number;
}

class DryRunRollback extends Error {
  constructor(public result: BillingRunResult) {
    super('dry-run rollback');
  }
}

/**
 * Bills every Active subscription whose billing cursor is due as of `asOfDate`.
 *
 * Guarantees:
 *  - exactly-once per (subscription, period): UNIQUE(subscription_id, period_start) and
 *    UNIQUE(subscription_id, period_index) in the schema are the final authority;
 *  - no skipped periods: each subscription is advanced one period at a time until the cursor is
 *    past `asOfDate` (catch-up), never jumping to the latest period;
 *  - atomic per subscription: all periods of one subscription commit or roll back together, and a
 *    failing subscription never blocks or undoes the others;
 *  - safe under concurrency: each subscription is processed in a BEGIN IMMEDIATE transaction that
 *    re-reads the cursor after taking the write lock, so a second runner sees the first one's work.
 */
export function runBillingCycle(
  asOfDate: string = todayIso(),
  operatorOrOptions?: number | BillingRunOptions
): BillingRunResult {
  const opts: BillingRunOptions =
    typeof operatorOrOptions === 'number' ? { operatorUserId: operatorOrOptions } : operatorOrOptions ?? {};

  const exec = (): BillingRunResult => {
    const result: BillingRunResult = {
      asOfDate,
      dryRun: !!opts.dryRun,
      processedCount: 0,
      invoicesCreated: 0,
      skippedDuplicates: 0,
      errors: 0,
      totalBilledAmount: 0,
      invoiceIds: [],
      details: []
    };
    let totalCents = 0;

    const taxes = TaxTable.load();

    const due = queryAll<DueSubscription>(
      `SELECT s.id, s.subscription_number, s.customer_id, s.discount_rule_id, s.payment_terms,
              s.start_date, s.expiry_date, p.billing_interval
       FROM subscriptions s JOIN plans p ON p.id = s.plan_id
       WHERE s.status = 'Active' AND s.next_billing_date <= ?
       ORDER BY s.id`,
      [asOfDate]
    );
    result.processedCount = due.length;

    for (const sub of due) {
      // Counters are collected per subscription and merged only after its transaction commits,
      // so a rolled-back subscription never leaks into the run totals.
      const local: BillingRunResult = { ...result, invoicesCreated: 0, skippedDuplicates: 0, invoiceIds: [], details: [] };
      try {
        const cents = runTransaction(() => billSubscription(sub, asOfDate, taxes, opts, local));
        totalCents += cents;
        result.invoicesCreated += local.invoicesCreated;
        result.skippedDuplicates += local.skippedDuplicates;
        result.invoiceIds.push(...local.invoiceIds);
        result.details.push(...local.details);
      } catch (err) {
        result.errors++;
        result.details.push({
          subscriptionNumber: sub.subscription_number,
          status: 'error',
          reason: err instanceof Error ? err.message : 'Unknown billing error'
        });
      }
    }

    autoCloseExpired(asOfDate, opts.operatorUserId, result);

    result.totalBilledAmount = fromCents(totalCents);

    if (!opts.dryRun) {
      audit(
        'BILLING_RUN',
        `Billing run as of ${asOfDate}: ${result.invoicesCreated} invoices created, ${result.skippedDuplicates} already billed, ${result.errors} errors.`,
        opts.operatorUserId,
        { ...result, details: undefined, invoiceIds: undefined }
      );
    }
    return result;
  };

  if (!opts.dryRun) return exec();

  try {
    runTransaction(() => {
      throw new DryRunRollback(exec());
    });
  } catch (err) {
    if (err instanceof DryRunRollback) return err.result;
    throw err;
  }
  throw new Error('unreachable');
}

/** Bills all due periods of one subscription. Must run inside a transaction. Returns billed cents. */
function billSubscription(
  sub: DueSubscription,
  asOfDate: string,
  taxes: TaxTable,
  opts: BillingRunOptions,
  result: BillingRunResult
): number {
  // Re-read the cursor under the write lock: another runner may have billed this subscription already.
  const cursor = queryOne<CursorRow>('SELECT status, next_period_index FROM subscriptions WHERE id = ?', [sub.id]);
  if (!cursor || cursor.status !== 'Active') return 0;

  const lineRows = queryAll<{
    product_id: number; variant_id: number | null; quantity: number; unit_price: number; tax_id: number | null;
    product_name: string; attribute_name: string | null; option_name: string | null;
  }>(
    `SELECT sl.product_id, sl.variant_id, sl.quantity, sl.unit_price, sl.tax_id, p.name AS product_name,
            pv.attribute_name, pv.option_name
     FROM subscription_lines sl
     JOIN products p ON p.id = sl.product_id
     LEFT JOIN product_variants pv ON pv.id = sl.variant_id
     WHERE sl.subscription_id = ? ORDER BY sl.id`,
    [sub.id]
  );
  if (lineRows.length === 0) throw new Error('Subscription has no lines to bill');

  const termDays = paymentTermDays(sub.payment_terms);
  const year = asOfDate.slice(0, 4);
  let idx = cursor.next_period_index;
  let billedCents = 0;
  let periodsThisRun = 0;
  let discountRuleId = sub.discount_rule_id;

  for (; periodsThisRun < MAX_PERIODS_PER_SUBSCRIPTION_PER_RUN; periodsThisRun++, idx++) {
    const start = periodStart(sub.start_date, sub.billing_interval, idx);
    if (start > asOfDate) break;
    if (sub.expiry_date && start >= sub.expiry_date) break; // term ended: nothing left to bill
    const end = periodStart(sub.start_date, sub.billing_interval, idx + 1);

    const existing = queryOne<{ invoice_number: string }>(
      'SELECT invoice_number FROM invoices WHERE subscription_id = ? AND period_start = ?',
      [sub.id, start]
    );
    if (existing) {
      result.skippedDuplicates++;
      result.details.push({
        subscriptionNumber: sub.subscription_number,
        invoiceNumber: existing.invoice_number,
        periodStart: start,
        status: 'already_billed',
        reason: `Period ${start} already invoiced as ${existing.invoice_number}`
      });
      continue;
    }

    const billable: BillableLine[] = lineRows.map(l => ({
      productId: l.product_id,
      variantId: l.variant_id,
      description: `${l.product_name}${l.option_name ? ` (${l.attribute_name}: ${l.option_name})` : ''} [${start} to ${end}]`,
      quantity: l.quantity,
      unitPriceCents: toCents(l.unit_price),
      taxId: l.tax_id
    }));

    // Discount validity is judged at the period's own start date, so a catch-up run produces the same
    // invoices an on-time run would have (a discount that was valid in January still applies to January).
    // Validate, then atomically consume a use. If the last use was just taken by
    // someone else the claim fails and the invoice is simply issued without a discount.
    let rule = loadDiscountRule(discountRuleId);
    let calc = calculateInvoice(billable, taxes, rule, start);
    let claimed = false;
    if (calc.discount.applicable && rule) {
      claimed = claimDiscountUse(rule.id);
      if (!claimed) calc = calculateInvoice(billable, taxes, rule, start, false);
    }

    const invoiceNumber = `INV-${year}-${String(nextSequence('invoice')).padStart(6, '0')}`;
    const ins = execute(
      `INSERT INTO invoices (
         invoice_number, subscription_id, customer_id, period_index, period_start, period_end,
         subtotal, tax_amount, discount_amount, total_amount, amount_paid, status, issue_date, due_date
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
      [
        invoiceNumber, sub.id, sub.customer_id, idx, start, end,
        fromCents(calc.subtotalCents), fromCents(calc.taxCents), fromCents(calc.discountCents), fromCents(calc.totalCents),
        opts.autoConfirm ? 'Confirmed' : 'Draft', asOfDate, addDays(asOfDate, termDays)
      ]
    );
    const invoiceId = Number(ins.lastInsertRowid);

    for (const l of calc.lines) {
      execute(
        `INSERT INTO invoice_lines (
           invoice_id, kind, product_id, variant_id, description, quantity, unit_price,
           gross_amount, discount_amount, net_amount, tax_name, tax_rate, tax_amount, line_total
         ) VALUES (?, 'PRODUCT', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          invoiceId, l.productId, l.variantId, l.description, l.quantity, fromCents(l.unitPriceCents),
          fromCents(l.grossCents), fromCents(l.discountCents), fromCents(l.netCents),
          l.taxName, l.taxRate, fromCents(l.taxCents), fromCents(l.totalCents)
        ]
      );
    }

    if (claimed && rule) {
      execute(
        'INSERT INTO invoice_discounts (invoice_id, discount_rule_id, code, applies_to, amount) VALUES (?, ?, ?, ?, ?)',
        [invoiceId, rule.id, rule.code, rule.applies_to, fromCents(calc.discountCents)]
      );
      const after = queryOne<{ current_uses: number; max_uses: number }>(
        'SELECT current_uses, max_uses FROM discount_rules WHERE id = ?', [rule.id]
      )!;
      const exhausted = after.max_uses > 0 && after.current_uses >= after.max_uses;
      const expired = !!rule.end_date && end > rule.end_date; // the next period would start after the end date
      if (exhausted || expired) {
        // Stop applying it from the next invoice on, without anyone having to remember.
        execute('UPDATE subscriptions SET discount_rule_id = NULL WHERE id = ?', [sub.id]);
        discountRuleId = null;
        audit(
          'DISCOUNT_AUTO_EXPIRED',
          `Discount '${rule.code}' ${exhausted ? 'reached its usage limit' : 'reached its end date'} and was detached from ${sub.subscription_number}`,
          opts.operatorUserId,
          { subscriptionId: sub.id, ruleId: rule.id },
          { subscriptionId: sub.id }
        );
      }
    }

    billedCents += calc.totalCents;
    result.invoicesCreated++;
    result.invoiceIds.push(invoiceId);
    result.details.push({
      subscriptionNumber: sub.subscription_number,
      invoiceNumber,
      periodStart: start,
      amount: fromCents(calc.totalCents),
      status: 'created'
    });
  }

  // Advance the cursor once, after every period up to `asOfDate` has an invoice.
  const nextStart = periodStart(sub.start_date, sub.billing_interval, idx);
  execute(
    'UPDATE subscriptions SET next_period_index = ?, next_billing_date = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [idx, nextStart, sub.id]
  );

  if (periodsThisRun >= MAX_PERIODS_PER_SUBSCRIPTION_PER_RUN && nextStart <= asOfDate) {
    result.details.push({
      subscriptionNumber: sub.subscription_number,
      status: 'error',
      reason: `Catch-up limit of ${MAX_PERIODS_PER_SUBSCRIPTION_PER_RUN} periods reached; run billing again to continue`
    });
  }
  return billedCents;
}

/**
 * Plans with auto_close close their subscriptions by themselves once the term has ended and every
 * period that started before expiry has been billed.
 */
function autoCloseExpired(asOfDate: string, operatorUserId: number | undefined, result: BillingRunResult): void {
  const rows = queryAll<{ id: number; subscription_number: string; expiry_date: string; status: string }>(
    `SELECT s.id, s.subscription_number, s.expiry_date, s.status
     FROM subscriptions s JOIN plans p ON p.id = s.plan_id
     WHERE s.status IN ('Active', 'Paused') AND p.auto_close = 1
       AND s.expiry_date IS NOT NULL AND s.expiry_date <= ? AND s.next_billing_date >= s.expiry_date`,
    [asOfDate]
  );
  for (const r of rows) {
    runTransaction(() => {
      execute(
        "UPDATE subscriptions SET status = 'Closed', closed_on = ?, close_reason = 'EXPIRED', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        [asOfDate, r.id]
      );
      audit(
        'SUBSCRIPTION_TRANSITION',
        `Subscription ${r.subscription_number} auto-closed: plan term ended ${r.expiry_date}`,
        operatorUserId,
        { subscriptionId: r.id, from: r.status, to: 'Closed', auto: true },
        { subscriptionId: r.id }
      );
    });
    result.details.push({
      subscriptionNumber: r.subscription_number,
      status: 'auto_closed',
      reason: `Auto-closed as plan ended on ${r.expiry_date}`
    });
  }
}

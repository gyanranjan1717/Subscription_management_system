import { queryAll, queryOne, execute, runTransaction } from '../db/database.js';
import { conflict, notFound } from '../lib/errors.js';
import { addDays, BillingInterval, periodStart, todayIso } from '../lib/dates.js';
import { audit } from './audit.js';

export type SubscriptionStatus = 'Draft' | 'Quotation' | 'Confirmed' | 'Active' | 'Paused' | 'Closed';
export type InvoiceStatus = 'Draft' | 'Confirmed' | 'Paid' | 'Cancelled';

const VALID_SUBSCRIPTION_TRANSITIONS: Record<SubscriptionStatus, SubscriptionStatus[]> = {
  Draft: ['Quotation', 'Closed'],
  Quotation: ['Draft', 'Confirmed', 'Closed'],
  Confirmed: ['Active', 'Closed'],
  Active: ['Paused', 'Closed'],
  Paused: ['Active', 'Closed'],
  Closed: [] // terminal: a closed subscription is never reopened
};

const VALID_INVOICE_TRANSITIONS: Record<InvoiceStatus, InvoiceStatus[]> = {
  Draft: ['Confirmed', 'Cancelled'],
  Confirmed: ['Paid', 'Cancelled'],
  Paid: [],
  Cancelled: []
};

export function canTransitionSubscription(from: SubscriptionStatus, to: SubscriptionStatus): boolean {
  return VALID_SUBSCRIPTION_TRANSITIONS[from]?.includes(to) ?? false;
}

export function canTransitionInvoice(from: InvoiceStatus, to: InvoiceStatus): boolean {
  return VALID_INVOICE_TRANSITIONS[from]?.includes(to) ?? false;
}

interface SubRow {
  id: number;
  subscription_number: string;
  status: SubscriptionStatus;
  start_date: string;
  expiry_date: string | null;
  next_period_index: number;
  quotation_valid_until: string | null;
  template_id: number | null;
  plan_id: number;
  billing_interval: BillingInterval;
  can_pause: number;
  can_close_early: number;
  plan_start: string | null;
  plan_end: string | null;
  plan_active: number;
  min_quantity: number;
}

export function loadSubscriptionForTransition(subscriptionId: number): SubRow | null {
  return queryOne<SubRow>(
    `SELECT s.id, s.subscription_number, s.status, s.start_date, s.expiry_date, s.next_period_index,
            s.quotation_valid_until, s.template_id, s.plan_id,
            p.billing_interval, p.can_pause, p.can_close_early, p.min_quantity,
            p.start_date AS plan_start, p.end_date AS plan_end, p.is_active AS plan_active
     FROM subscriptions s JOIN plans p ON p.id = s.plan_id WHERE s.id = ?`,
    [subscriptionId]
  );
}

/** Plan availability window (A7) and per-line minimum quantity (A3). Throws 409 on violation. */
export function assertPlanUsable(sub: Pick<SubRow, 'start_date' | 'plan_start' | 'plan_end' | 'plan_active' | 'min_quantity' | 'id'>): void {
  if (!sub.plan_active) throw conflict('The plan of this subscription is no longer active.');
  if (sub.plan_start && sub.start_date < sub.plan_start) throw conflict(`Plan is only available from ${sub.plan_start}.`);
  if (sub.plan_end && sub.start_date > sub.plan_end) throw conflict(`Plan was only available until ${sub.plan_end}.`);
  const low = queryOne<{ n: number }>(
    'SELECT COUNT(*) AS n FROM subscription_lines WHERE subscription_id = ? AND quantity < ?',
    [sub.id, sub.min_quantity]
  );
  if (low && low.n > 0) throw conflict(`Every line needs a quantity of at least ${sub.min_quantity} for this plan.`);
}

/**
 * Moves a subscription to `newStatus`, enforcing the lifecycle, the plan policy flags and the
 * side effects of each transition. Throws HttpError (404 unknown, 409 not allowed).
 */
export function transitionSubscription(
  subscriptionId: number,
  newStatus: SubscriptionStatus,
  userId?: number,
  today: string = todayIso()
): { previousStatus: SubscriptionStatus; newStatus: SubscriptionStatus; message: string } {
  return runTransaction(() => {
    const sub = loadSubscriptionForTransition(subscriptionId);
    if (!sub) throw notFound('Subscription not found.');

    if (!canTransitionSubscription(sub.status, newStatus)) {
      throw conflict(
        `Invalid state transition from '${sub.status}' to '${newStatus}'. Allowed: ${VALID_SUBSCRIPTION_TRANSITIONS[sub.status].join(', ') || 'none (terminal state)'}.`
      );
    }

    const from = sub.status;

    if (newStatus === 'Quotation' && from === 'Draft') {
      const lines = queryOne<{ n: number }>('SELECT COUNT(*) AS n FROM subscription_lines WHERE subscription_id = ?', [sub.id])!;
      if (lines.n === 0) throw conflict('Add at least one line before sending a quotation.');
      const tpl = sub.template_id
        ? queryOne<{ validity_days: number }>('SELECT validity_days FROM quotation_templates WHERE id = ?', [sub.template_id])
        : null;
      execute(
        'UPDATE subscriptions SET quotation_sent_on = ?, quotation_valid_until = ? WHERE id = ?',
        [today, addDays(today, tpl?.validity_days ?? 30), sub.id]
      );
    }

    if (newStatus === 'Confirmed') {
      if (sub.quotation_valid_until && today > sub.quotation_valid_until) {
        throw conflict(`This quotation expired on ${sub.quotation_valid_until} and can no longer be confirmed.`);
      }
      assertPlanUsable(sub);
    }

    if (newStatus === 'Active' && from === 'Confirmed') {
      // The billing cursor starts at period 0 on the start date.
      execute(
        'UPDATE subscriptions SET next_period_index = 0, next_billing_date = start_date WHERE id = ?',
        [sub.id]
      );
    }

    if (newStatus === 'Paused') {
      if (!sub.can_pause) throw conflict('This plan does not allow pausing.');
      execute('INSERT INTO subscription_pauses (subscription_id, paused_on) VALUES (?, ?)', [sub.id, today]);
    }

    if (newStatus === 'Active' && from === 'Paused') {
      skipPausedPeriods(sub, today);
    }

    if (newStatus === 'Closed') {
      const live = from === 'Active' || from === 'Paused';
      if (live && !sub.can_close_early) throw conflict('This plan does not allow closing early.');
      execute(
        'UPDATE subscriptions SET closed_on = ?, close_reason = ? WHERE id = ?',
        [today, live ? 'EARLY' : 'DISCARDED', sub.id]
      );
    }

    execute('UPDATE subscriptions SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [newStatus, sub.id]);
    audit(
      'SUBSCRIPTION_TRANSITION',
      `Subscription ${sub.subscription_number} transitioned from ${from} to ${newStatus}`,
      userId,
      { subscriptionId: sub.id, from, to: newStatus },
      { subscriptionId: sub.id }
    );

    return { previousStatus: from, newStatus, message: `Successfully transitioned to ${newStatus}` };
  });
}

/**
 * On resume, periods that started while the subscription was paused are not billed (A9). They are
 * recorded in subscription_period_skips so the integrity report can tell "skipped on purpose"
 * from "missed", and the cursor moves past them.
 */
function skipPausedPeriods(sub: SubRow, resumeDate: string): void {
  const pause = queryOne<{ id: number; paused_on: string }>(
    'SELECT id, paused_on FROM subscription_pauses WHERE subscription_id = ? AND resumed_on IS NULL ORDER BY id DESC LIMIT 1',
    [sub.id]
  );
  if (!pause) return;
  execute('UPDATE subscription_pauses SET resumed_on = ? WHERE id = ?', [resumeDate, pause.id]);

  let idx = sub.next_period_index;
  for (let guard = 0; guard < 5000; guard++, idx++) {
    const start = periodStart(sub.start_date, sub.billing_interval, idx);
    if (start >= resumeDate) break;
    if (start < pause.paused_on) continue; // started before the pause: still owed
    execute(
      "INSERT OR IGNORE INTO subscription_period_skips (subscription_id, period_index, reason) VALUES (?, ?, 'paused')",
      [sub.id, idx]
    );
  }
  // Only advance past a contiguous run of skipped periods; owed earlier periods keep the cursor where it is.
  const skipped = new Set(
    queryAll<{ period_index: number }>('SELECT period_index FROM subscription_period_skips WHERE subscription_id = ?', [sub.id])
      .map(r => r.period_index)
  );
  let cursor = sub.next_period_index;
  while (skipped.has(cursor)) cursor++;
  if (cursor !== sub.next_period_index) {
    execute(
      'UPDATE subscriptions SET next_period_index = ?, next_billing_date = ? WHERE id = ?',
      [cursor, periodStart(sub.start_date, sub.billing_interval, cursor), sub.id]
    );
  }
}

export function transitionInvoice(
  invoiceId: number,
  newStatus: InvoiceStatus,
  userId?: number
): { previousStatus: InvoiceStatus; message: string } {
  return runTransaction(() => {
    const inv = queryOne<{ id: number; subscription_id: number; status: InvoiceStatus; total_amount: number; amount_paid: number }>(
      'SELECT id, subscription_id, status, total_amount, amount_paid FROM invoices WHERE id = ?',
      [invoiceId]
    );
    if (!inv) throw notFound('Invoice not found.');

    if (!canTransitionInvoice(inv.status, newStatus)) {
      throw conflict(
        `Invalid invoice transition from '${inv.status}' to '${newStatus}'. Allowed: ${VALID_INVOICE_TRANSITIONS[inv.status].join(', ') || 'none'}.`
      );
    }
    if (newStatus === 'Paid') {
      // Paid is reached by recording payments; it cannot be set by hand.
      throw conflict('An invoice becomes Paid automatically when its full balance has been recorded as payments.');
    }
    if (newStatus === 'Cancelled' && inv.amount_paid > 0) {
      throw conflict('An invoice with recorded payments cannot be cancelled.');
    }

    execute('UPDATE invoices SET status = ? WHERE id = ?', [newStatus, invoiceId]);
    audit(
      'INVOICE_TRANSITION',
      `Invoice #${invoiceId} transitioned from ${inv.status} to ${newStatus}`,
      userId,
      { invoiceId, from: inv.status, to: newStatus },
      { invoiceId, subscriptionId: inv.subscription_id }
    );
    return { previousStatus: inv.status, message: `Invoice #${invoiceId} status updated to ${newStatus}` };
  });
}

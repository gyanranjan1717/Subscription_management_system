import { queryAll } from '../db/database.js';

export type TimelineEventType = 'status_change' | 'renewal' | 'invoice' | 'invoice_status' | 'payment' | 'other';

export interface TimelineEvent {
  id: string;
  type: TimelineEventType;
  title: string;
  description: string;
  timestamp: string;
  amount?: number;
  from?: string;
  to?: string;
}

// SQLite CURRENT_TIMESTAMP is "YYYY-MM-DD HH:MM:SS"; date-only columns have no time part.
function toSortKey(ts: string): string {
  return ts.includes('T') ? ts.replace('T', ' ').slice(0, 19) : ts.length === 10 ? `${ts} 00:00:00` : ts;
}

export function buildSubscriptionTimeline(subscriptionId: number): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  const invoices = queryAll<{
    id: number; invoice_number: string; total_amount: number; period_start: string;
    period_end: string; issue_date: string; created_at: string;
  }>(
    `SELECT id, invoice_number, total_amount, period_start, period_end, issue_date, created_at
     FROM invoices WHERE subscription_id = ?`,
    [subscriptionId]
  );

  for (const inv of invoices) {
    events.push({
      id: `invoice-${inv.id}`,
      type: 'invoice',
      title: `Invoice ${inv.invoice_number} issued`,
      description: `Billing period ${inv.period_start} to ${inv.period_end}`,
      timestamp: inv.created_at || inv.issue_date,
      amount: inv.total_amount
    });
  }

  const payments = queryAll<{
    id: number; amount: number; payment_method: string; payment_date: string;
    created_at: string; invoice_number: string;
  }>(
    `SELECT p.id, p.amount, p.payment_method, p.payment_date, p.created_at, i.invoice_number
     FROM payments p JOIN invoices i ON p.invoice_id = i.id
     WHERE i.subscription_id = ?`,
    [subscriptionId]
  );

  for (const pay of payments) {
    events.push({
      id: `payment-${pay.id}`,
      type: 'payment',
      title: `Payment received for ${pay.invoice_number}`,
      description: `Paid via ${pay.payment_method}`,
      timestamp: pay.created_at || pay.payment_date,
      amount: pay.amount
    });
  }

  // Audit entries tied to this subscription directly, or to one of its invoices.
  const audits = queryAll<{
    id: number; event_type: string; description: string; created_at: string; metadata_json: string | null;
  }>(
    `SELECT id, event_type, description, created_at, metadata_json
     FROM audit_logs
     WHERE event_type IN ('SUBSCRIPTION_TRANSITION', 'SUBSCRIPTION_RENEWED', 'INVOICE_TRANSITION')
       AND (subscription_id = ? OR invoice_id IN (SELECT id FROM invoices WHERE subscription_id = ?))`,
    [subscriptionId, subscriptionId]
  );

  const invoiceIds = new Set(invoices.map(i => i.id));
  const invoiceNumbers = new Map(invoices.map(i => [i.id, i.invoice_number]));

  for (const log of audits) {
    let meta: any;
    try { meta = JSON.parse(log.metadata_json ?? '{}'); } catch { continue; }

    if (log.event_type === 'SUBSCRIPTION_TRANSITION' && meta.subscriptionId === subscriptionId) {
      events.push({
        id: `audit-${log.id}`,
        type: 'status_change',
        title: `Status changed to ${meta.to}`,
        description: `${meta.from} → ${meta.to}`,
        timestamp: log.created_at,
        from: meta.from,
        to: meta.to
      });
    } else if (log.event_type === 'SUBSCRIPTION_RENEWED' && meta.subscriptionId === subscriptionId) {
      events.push({
        id: `audit-${log.id}`,
        type: 'renewal',
        title: 'Subscription renewed',
        description: log.description,
        timestamp: log.created_at,
        to: 'Renewed'
      });
    } else if (log.event_type === 'INVOICE_TRANSITION' && invoiceIds.has(meta.invoiceId)) {
      events.push({
        id: `audit-${log.id}`,
        type: 'invoice_status',
        title: `Invoice ${invoiceNumbers.get(meta.invoiceId)} ${meta.to}`,
        description: `${meta.from} → ${meta.to}`,
        timestamp: log.created_at,
        from: meta.from,
        to: meta.to
      });
    }
  }

  // Chronological (oldest first); ties keep a stable, deterministic order via id.
  return events.sort((a, b) => {
    const cmp = toSortKey(a.timestamp).localeCompare(toSortKey(b.timestamp));
    return cmp !== 0 ? cmp : a.id.localeCompare(b.id);
  });
}

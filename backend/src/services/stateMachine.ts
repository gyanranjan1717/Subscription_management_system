import { queryOne, execute } from '../db/database.js';

export type SubscriptionStatus = 'Draft' | 'Quotation' | 'Confirmed' | 'Active' | 'Paused' | 'Closed';
export type InvoiceStatus = 'Draft' | 'Confirmed' | 'Paid' | 'Cancelled';

const VALID_SUBSCRIPTION_TRANSITIONS: Record<SubscriptionStatus, SubscriptionStatus[]> = {
  Draft: ['Quotation', 'Closed'],
  Quotation: ['Confirmed', 'Closed'],
  Confirmed: ['Active', 'Closed'],
  Active: ['Paused', 'Closed'],
  Paused: ['Active', 'Closed'],
  Closed: [] // terminal state
};

const VALID_INVOICE_TRANSITIONS: Record<InvoiceStatus, InvoiceStatus[]> = {
  Draft: ['Confirmed', 'Cancelled'],
  Confirmed: ['Paid', 'Cancelled'],
  Paid: [], // terminal state
  Cancelled: [] // terminal state
};

export function canTransitionSubscription(from: SubscriptionStatus, to: SubscriptionStatus): boolean {
  return VALID_SUBSCRIPTION_TRANSITIONS[from]?.includes(to) ?? false;
}

export function canTransitionInvoice(from: InvoiceStatus, to: InvoiceStatus): boolean {
  return VALID_INVOICE_TRANSITIONS[from]?.includes(to) ?? false;
}

export function transitionSubscription(
  subscriptionId: number,
  newStatus: SubscriptionStatus,
  userId?: number
): { success: boolean; message: string; previousStatus?: string } {
  const sub = queryOne<{ id: number; status: SubscriptionStatus; plan_id: number }>(
    'SELECT s.id, s.status, s.plan_id, p.can_pause, p.can_renew FROM subscriptions s JOIN plans p ON s.plan_id = p.id WHERE s.id = ?',
    [subscriptionId]
  );

  if (!sub) {
    return { success: false, message: 'Subscription not found' };
  }

  if (newStatus === 'Paused') {
    const plan = queryOne<{ can_pause: number }>('SELECT can_pause FROM plans WHERE id = ?', [sub.plan_id]);
    if (plan && plan.can_pause === 0) {
      return { success: false, message: 'This plan policy does not allow pausing' };
    }
  }

  if (!canTransitionSubscription(sub.status, newStatus)) {
    return {
      success: false,
      message: `Invalid state transition from '${sub.status}' to '${newStatus}'. Allowed transitions: ${VALID_SUBSCRIPTION_TRANSITIONS[sub.status].join(', ') || 'None (Terminal)'}`
    };
  }

  execute(
    'UPDATE subscriptions SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [newStatus, subscriptionId]
  );

  // Log transition in audit log
  execute(
    'INSERT INTO audit_logs (event_type, description, user_id, metadata_json) VALUES (?, ?, ?, ?)',
    [
      'SUBSCRIPTION_TRANSITION',
      `Subscription #${subscriptionId} transitioned from ${sub.status} to ${newStatus}`,
      userId || null,
      JSON.stringify({ subscriptionId, from: sub.status, to: newStatus })
    ]
  );

  return { success: true, message: `Successfully transitioned to ${newStatus}`, previousStatus: sub.status };
}

export function transitionInvoice(
  invoiceId: number,
  newStatus: InvoiceStatus,
  userId?: number
): { success: boolean; message: string; previousStatus?: string } {
  const inv = queryOne<{ id: number; status: InvoiceStatus; total_amount: number; amount_paid: number }>(
    'SELECT id, status, total_amount, amount_paid FROM invoices WHERE id = ?',
    [invoiceId]
  );

  if (!inv) {
    return { success: false, message: 'Invoice not found' };
  }

  if (newStatus === 'Paid' && inv.amount_paid < inv.total_amount) {
    return {
      success: false,
      message: `Cannot transition invoice #${invoiceId} to Paid. Amount paid ($${inv.amount_paid}) is less than total ($${inv.total_amount})`
    };
  }

  if (!canTransitionInvoice(inv.status, newStatus)) {
    return {
      success: false,
      message: `Invalid invoice transition from '${inv.status}' to '${newStatus}'. Allowed: ${VALID_INVOICE_TRANSITIONS[inv.status].join(', ') || 'None'}`
    };
  }

  execute('UPDATE invoices SET status = ? WHERE id = ?', [newStatus, invoiceId]);

  execute(
    'INSERT INTO audit_logs (event_type, description, user_id, metadata_json) VALUES (?, ?, ?, ?)',
    [
      'INVOICE_TRANSITION',
      `Invoice #${invoiceId} transitioned from ${inv.status} to ${newStatus}`,
      userId || null,
      JSON.stringify({ invoiceId, from: inv.status, to: newStatus })
    ]
  );

  return { success: true, message: `Invoice #${invoiceId} status updated to ${newStatus}`, previousStatus: inv.status };
}

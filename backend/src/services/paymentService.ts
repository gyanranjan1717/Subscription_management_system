import { queryOne, execute, runTransaction } from '../db/database.js';
import { conflict, notFound } from '../lib/errors.js';
import { Cents, fromCents, toCents } from '../lib/money.js';
import { audit } from './audit.js';

export const PAYMENT_METHODS = ['Bank Transfer', 'Credit Card', 'UPI', 'Cash', 'Cheque'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export interface RecordPaymentInput {
  invoiceId: number;
  amountCents: Cents;
  method: PaymentMethod;
  paymentDate: string;
  reference?: string | null;
  note?: string | null;
  userId?: number;
}

/**
 * Records a payment against one invoice. The invoice is re-read inside the write transaction, so
 * two simultaneous payments cannot both pass the balance check on stale data.
 * Rules: invoice must be Confirmed; payment must be > 0 and <= outstanding balance; the invoice
 * flips to Paid exactly when the balance reaches zero.
 */
export function recordPayment(input: RecordPaymentInput) {
  return runTransaction(() => {
    const inv = queryOne<{
      id: number; invoice_number: string; subscription_id: number; total_amount: number; amount_paid: number; status: string;
    }>('SELECT id, invoice_number, subscription_id, total_amount, amount_paid, status FROM invoices WHERE id = ?', [input.invoiceId]);
    if (!inv) throw notFound('Invoice not found.');

    if (inv.status !== 'Confirmed') {
      throw conflict(
        inv.status === 'Paid' ? 'This invoice is already fully paid.'
          : inv.status === 'Cancelled' ? 'Cannot record a payment on a cancelled invoice.'
          : 'Confirm the invoice before recording payments against it.'
      );
    }

    const outstanding = toCents(inv.total_amount) - toCents(inv.amount_paid);
    if (input.amountCents > outstanding) {
      throw conflict(`Payment of ${fromCents(input.amountCents).toFixed(2)} exceeds the outstanding balance of ${fromCents(outstanding).toFixed(2)}.`);
    }

    const ins = execute(
      `INSERT INTO payments (invoice_id, amount, payment_method, payment_date, reference, note, recorded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [inv.id, fromCents(input.amountCents), input.method, input.paymentDate, input.reference ?? null, input.note ?? null, input.userId ?? null]
    );

    const newPaid = toCents(inv.amount_paid) + input.amountCents;
    const newOutstanding = toCents(inv.total_amount) - newPaid;
    const newStatus = newOutstanding === 0 ? 'Paid' : 'Confirmed';
    execute('UPDATE invoices SET amount_paid = ?, status = ? WHERE id = ?', [fromCents(newPaid), newStatus, inv.id]);

    audit(
      'PAYMENT_RECORDED',
      `Payment of ${fromCents(input.amountCents).toFixed(2)} via ${input.method} recorded on invoice ${inv.invoice_number}`,
      input.userId,
      { invoiceId: inv.id, amount: fromCents(input.amountCents), paymentMethod: input.method, newStatus },
      { invoiceId: inv.id, subscriptionId: inv.subscription_id }
    );

    return {
      paymentId: Number(ins.lastInsertRowid),
      invoiceNumber: inv.invoice_number,
      totalAmount: inv.total_amount,
      amountPaid: fromCents(newPaid),
      balanceRemaining: fromCents(newOutstanding),
      status: newStatus
    };
  });
}

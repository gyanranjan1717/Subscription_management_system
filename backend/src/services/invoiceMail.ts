import { queryAll, queryOne, runTransaction } from '../db/database.js';
import { conflict, notFound } from '../lib/errors.js';
import { toCents, fromCents } from '../lib/money.js';
import { todayIso } from '../lib/dates.js';
import { audit } from './audit.js';
import { appUrl, queueEmail } from './mailer.js';

const inr = (n: number) => `INR ${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

interface MailInvoice {
  id: number; invoice_number: string; subscription_id: number; status: string;
  total_amount: number; amount_paid: number; due_date: string; email: string; full_name: string;
}

const loadForMail = (id: number) => queryOne<MailInvoice>(
  `SELECT i.id, i.invoice_number, i.subscription_id, i.status, i.total_amount, i.amount_paid, i.due_date, u.email, u.full_name
   FROM invoices i JOIN users u ON u.id = i.customer_id WHERE i.id = ?`, [id]);

/** Emails an invoice summary to the customer. */
export function sendInvoiceEmail(invoiceId: number, actorId: number): { email: string; invoiceNumber: string } {
  const inv = loadForMail(invoiceId);
  if (!inv) throw notFound('Invoice not found.');
  if (inv.status === 'Draft') throw conflict('Confirm the invoice before sending it to the customer.');

  const balance = fromCents(toCents(inv.total_amount) - toCents(inv.amount_paid));
  runTransaction(() => {
    queueEmail({
      to: inv.email,
      subject: `Invoice ${inv.invoice_number} from Brightloop`,
      text: `Hello ${inv.full_name},\n\nInvoice ${inv.invoice_number} for ${inr(inv.total_amount)} is ready.\n` +
        `Amount due: ${inr(balance)}\nDue date: ${inv.due_date}\n\nView and pay it online: ${appUrl()}\n\nThank you,\nBrightloop Software`,
      kind: 'INVOICE',
      relatedId: inv.id
    });
    audit('INVOICE_SENT', `Invoice ${inv.invoice_number} dispatched to ${inv.email}`, actorId,
      { invoiceId: inv.id, recipient: inv.email }, { invoiceId: inv.id, subscriptionId: inv.subscription_id });
  });
  return { email: inv.email, invoiceNumber: inv.invoice_number };
}

/** A customer is not chased about the same invoice more than once in this window. */
const REMINDER_COOLDOWN_HOURS = 24;

function recentlyReminded(invoiceId: number): boolean {
  const last = queryOne<{ created_at: string }>(
    "SELECT created_at FROM audit_logs WHERE event_type = 'PAYMENT_REMINDER_SENT' AND invoice_id = ? ORDER BY id DESC LIMIT 1", [invoiceId]
  )?.created_at;
  if (!last) return false;
  return Date.now() - Date.parse(last.replace(' ', 'T') + 'Z') < REMINDER_COOLDOWN_HOURS * 3600 * 1000;
}

function remind(inv: MailInvoice, actorId: number): void {
  const balance = fromCents(toCents(inv.total_amount) - toCents(inv.amount_paid));
  const overdue = inv.due_date < todayIso();
  queueEmail({
    to: inv.email,
    subject: `${overdue ? 'Overdue: ' : 'Reminder: '}invoice ${inv.invoice_number}`,
    text: `Hello ${inv.full_name},\n\nThis is a friendly reminder that invoice ${inv.invoice_number} ` +
      `${overdue ? `was due on ${inv.due_date} and is now overdue` : `is due on ${inv.due_date}`}.\n` +
      `Outstanding balance: ${inr(balance)}\n\nPay securely online from your portal: ${appUrl()}\n\n` +
      `If you have already paid, please ignore this message.\n\nBrightloop Software`,
    kind: 'REMINDER',
    relatedId: inv.id
  });
  audit('PAYMENT_REMINDER_SENT', `Payment reminder for ${inv.invoice_number} sent to ${inv.email}`, actorId,
    { invoiceId: inv.id, balance, overdue }, { invoiceId: inv.id, subscriptionId: inv.subscription_id });
}

/** One reminder for one unpaid invoice. */
export function sendReminder(invoiceId: number, actorId: number): { email: string; invoiceNumber: string } {
  const inv = loadForMail(invoiceId);
  if (!inv) throw notFound('Invoice not found.');
  if (inv.status !== 'Confirmed' || toCents(inv.amount_paid) >= toCents(inv.total_amount)) {
    throw conflict('Only unpaid, confirmed invoices can be chased.');
  }
  if (recentlyReminded(inv.id)) throw conflict(`A reminder for ${inv.invoice_number} was already sent in the last ${REMINDER_COOLDOWN_HOURS} hours.`);
  runTransaction(() => remind(inv, actorId));
  return { email: inv.email, invoiceNumber: inv.invoice_number };
}

/** Chases every overdue invoice that has not been chased recently. */
export function remindAllOverdue(actorId: number): { sent: number; skipped: number; invoices: string[] } {
  const rows = queryAll<MailInvoice>(
    `SELECT i.id, i.invoice_number, i.subscription_id, i.status, i.total_amount, i.amount_paid, i.due_date, u.email, u.full_name
     FROM invoices i JOIN users u ON u.id = i.customer_id
     WHERE i.status = 'Confirmed' AND i.amount_paid < i.total_amount AND i.due_date < ? ORDER BY i.due_date`, [todayIso()]);
  const sent: string[] = [];
  let skipped = 0;
  runTransaction(() => {
    for (const inv of rows) {
      if (recentlyReminded(inv.id)) { skipped++; continue; }
      remind(inv, actorId);
      sent.push(inv.invoice_number);
    }
  });
  return { sent: sent.length, skipped, invoices: sent };
}

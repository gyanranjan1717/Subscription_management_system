import { queryOne, execute, runTransaction } from '../db/database.js';
import { badRequest, conflict, notFound, HttpError } from '../lib/errors.js';
import { Cents, fromCents, toCents } from '../lib/money.js';
import { todayIso } from '../lib/dates.js';
import { assertCanAccessCustomerData, AuthUser } from '../middleware/auth.js';
import { audit } from './audit.js';
import { PaymentMethod, recordPayment } from './paymentService.js';
import { gateway, razorpayKeyId, razorpayConfigured, verifyCheckoutSignature, GatewayPayment } from './razorpay.js';

/** Razorpay will not create an order below 1 INR. */
const MIN_ONLINE_PAYMENT_CENTS: Cents = 100;

interface InvoiceRow {
  id: number; invoice_number: string; customer_id: number; subscription_id: number;
  total_amount: number; amount_paid: number; status: string;
}

interface OrderRow {
  id: number; gateway_order_id: string; gateway_payment_id: string | null; invoice_id: number;
  amount: number; currency: string; status: 'created' | 'paid' | 'failed'; payment_id: number | null;
}

const loadInvoice = (id: number) =>
  queryOne<InvoiceRow>(
    'SELECT id, invoice_number, customer_id, subscription_id, total_amount, amount_paid, status FROM invoices WHERE id = ?', [id]
  );

/** Maps the gateway's payment method to the ledger's payment methods. */
function ledgerMethod(method: string | undefined): PaymentMethod {
  switch (method) {
    case 'upi': return 'UPI';
    case 'netbanking': return 'Bank Transfer';
    default: return 'Credit Card'; // card, wallet, emi, paylater
  }
}

export interface CreatedOrder {
  orderId: string;
  keyId: string;
  invoiceId: number;
  invoiceNumber: string;
  amountPaise: number;
  amountInr: number;
  balanceInr: number;
  currency: 'INR';
  prefill: { name: string; email: string };
}

/**
 * Creates a gateway order for an invoice. The amount is decided here: the requested part-payment
 * (default: the full balance) is checked against the outstanding balance, and that value is stored
 * with the order. Nothing the browser sends later can change what gets credited.
 */
export async function createOnlineOrder(
  user: AuthUser,
  invoiceId: number,
  requestedCents: Cents | null
): Promise<CreatedOrder> {
  if (!razorpayConfigured()) throw new HttpError(503, 'Online payments are not configured on this server.');

  const inv = loadInvoice(invoiceId);
  if (!inv) throw notFound('Invoice not found.');
  assertCanAccessCustomerData(user, inv.customer_id);

  if (inv.status === 'Paid') throw conflict('This invoice is already fully paid.');
  if (inv.status !== 'Confirmed') throw conflict(`Only confirmed invoices can be paid (this one is ${inv.status}).`);

  const balance = toCents(inv.total_amount) - toCents(inv.amount_paid);
  if (balance <= 0) throw conflict('This invoice has no outstanding balance.');

  const amount = requestedCents ?? balance;
  if (amount > balance) throw badRequest(`Amount exceeds the outstanding balance of ${fromCents(balance).toFixed(2)}.`);
  // A part-payment may not leave a remainder the gateway could never collect.
  if (amount < MIN_ONLINE_PAYMENT_CENTS) throw badRequest('The minimum online payment is 1.00.');
  if (balance - amount > 0 && balance - amount < MIN_ONLINE_PAYMENT_CENTS) {
    throw badRequest('That would leave less than 1.00 outstanding. Pay the full balance instead.');
  }

  const order = await gateway().createOrder({
    amountPaise: amount,
    receipt: inv.invoice_number.slice(0, 40),
    notes: { invoice_id: String(inv.id), invoice_number: inv.invoice_number }
  });
  if (order.amount !== amount || order.currency !== 'INR') {
    throw new HttpError(502, 'The payment gateway returned an unexpected order.');
  }

  execute(
    'INSERT INTO payment_orders (gateway_order_id, invoice_id, created_by, amount, currency) VALUES (?, ?, ?, ?, ?)',
    [order.id, inv.id, user.id, fromCents(amount), order.currency]
  );
  audit('ONLINE_ORDER_CREATED', `Online payment of ${fromCents(amount).toFixed(2)} started for ${inv.invoice_number}`, user.id,
    { orderId: order.id, amount: fromCents(amount) }, { invoiceId: inv.id, subscriptionId: inv.subscription_id });

  const customer = queryOne<{ full_name: string; email: string }>('SELECT full_name, email FROM users WHERE id = ?', [inv.customer_id])!;
  return {
    orderId: order.id,
    keyId: razorpayKeyId()!,
    invoiceId: inv.id,
    invoiceNumber: inv.invoice_number,
    amountPaise: amount,
    amountInr: fromCents(amount),
    balanceInr: fromCents(balance),
    currency: 'INR',
    prefill: { name: customer.full_name, email: customer.email }
  };
}

export interface OnlinePaymentResult {
  alreadyProcessed: boolean;
  paymentId: number;
  invoiceNumber: string;
  amountPaid: number;
  balanceRemaining: number;
  status: string;
}

/**
 * Turns a paid gateway order into a ledger payment, exactly once. Used by both the browser callback
 * and the webhook, which can arrive in either order or twice: the order row is the guard.
 * The gateway is asked for the truth (order, amount, currency, captured state); we never trust the client.
 */
export async function fulfillOrder(gatewayOrderId: string, gatewayPaymentId: string, actor: { id: number } | null): Promise<OnlinePaymentResult> {
  const order = queryOne<OrderRow>('SELECT * FROM payment_orders WHERE gateway_order_id = ?', [gatewayOrderId]);
  if (!order) throw notFound('Unknown payment order.');

  const done = (o: OrderRow, already: boolean): OnlinePaymentResult => {
    const inv = loadInvoice(o.invoice_id)!;
    return {
      alreadyProcessed: already,
      paymentId: o.payment_id!,
      invoiceNumber: inv.invoice_number,
      amountPaid: inv.amount_paid,
      balanceRemaining: fromCents(toCents(inv.total_amount) - toCents(inv.amount_paid)),
      status: inv.status
    };
  };

  if (order.status === 'paid') {
    if (order.gateway_payment_id !== gatewayPaymentId) throw conflict('This order was already settled by a different payment.');
    return done(order, true);
  }

  let payment: GatewayPayment = await gateway().fetchPayment(gatewayPaymentId);
  if (payment.order_id !== order.gateway_order_id) throw badRequest('This payment does not belong to the order.');
  if (payment.currency !== order.currency || payment.amount !== toCents(order.amount)) {
    throw badRequest('The paid amount does not match the order.');
  }
  if (payment.status === 'authorized') {
    payment = await gateway().capturePayment(payment.id, payment.amount, payment.currency);
  }
  if (payment.status !== 'captured') {
    throw conflict(`The payment is ${payment.status}; it has not been completed.`);
  }

  class NotApplicable extends Error {}

  try {
    return runTransaction(() => {
      const fresh = queryOne<OrderRow>('SELECT * FROM payment_orders WHERE id = ?', [order.id])!;
      if (fresh.status === 'paid') return done(fresh, true);

      let recorded;
      try {
        recorded = recordPayment({
          invoiceId: order.invoice_id,
          amountCents: toCents(order.amount),
          method: ledgerMethod(payment.method),
          paymentDate: todayIso(),
          reference: `razorpay:${payment.id}`,
          note: `Online payment (order ${order.gateway_order_id})`,
          userId: actor?.id
        });
      } catch (err) {
        throw new NotApplicable(err instanceof Error ? err.message : 'unknown');
      }

      execute(
        "UPDATE payment_orders SET status = 'paid', gateway_payment_id = ?, payment_id = ?, paid_at = CURRENT_TIMESTAMP WHERE id = ?",
        [payment.id, recorded.paymentId, order.id]
      );
      return {
        alreadyProcessed: false,
        paymentId: recorded.paymentId,
        invoiceNumber: recorded.invoiceNumber,
        amountPaid: recorded.amountPaid,
        balanceRemaining: recorded.balanceRemaining,
        status: recorded.status
      };
    });
  } catch (err) {
    if (!(err instanceof NotApplicable)) throw err;
    // The money was captured but the invoice could no longer take it (settled meanwhile): flag it for a refund.
    const inv = loadInvoice(order.invoice_id)!;
    execute("UPDATE payment_orders SET status = 'failed', gateway_payment_id = ? WHERE id = ?", [payment.id, order.id]);
    audit('ONLINE_PAYMENT_NEEDS_REFUND', `Captured payment ${payment.id} could not be applied to ${inv.invoice_number}`, actor?.id,
      { orderId: order.gateway_order_id, paymentId: payment.id, reason: err.message },
      { invoiceId: inv.id, subscriptionId: inv.subscription_id });
    throw conflict('Your payment was received but the invoice was already settled. It will be refunded.');
  }
}

/** Browser callback: the signature proves the payment id belongs to this order, then we fulfil it. */
export async function confirmCheckout(
  user: AuthUser,
  input: { orderId: string; paymentId: string; signature: string }
): Promise<OnlinePaymentResult> {
  const order = queryOne<OrderRow>('SELECT * FROM payment_orders WHERE gateway_order_id = ?', [input.orderId]);
  if (!order) throw notFound('Unknown payment order.');
  const inv = loadInvoice(order.invoice_id)!;
  assertCanAccessCustomerData(user, inv.customer_id);

  if (!verifyCheckoutSignature(input.orderId, input.paymentId, input.signature)) {
    audit('ONLINE_PAYMENT_REJECTED', `Invalid payment signature for ${inv.invoice_number}`, user.id,
      { orderId: input.orderId }, { invoiceId: inv.id, subscriptionId: inv.subscription_id });
    throw badRequest('Payment verification failed: invalid signature.');
  }
  return fulfillOrder(input.orderId, input.paymentId, user);
}

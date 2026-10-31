import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { api, apiUrl, baseFixture, closeServer, queryOne, queryAll, Fixture, newSubscription } from './helpers.js';
import { runBillingCycle } from '../src/services/billingEngine.js';
import { setGateway, GatewayPayment, PaymentGateway } from '../src/services/razorpay.js';

const SECRET = process.env.RAZORPAY_KEY_SECRET!;
const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET!;
const sign = (orderId: string, paymentId: string) => crypto.createHmac('sha256', SECRET).update(`${orderId}|${paymentId}`).digest('hex');

/** Stand-in for Razorpay's servers. Signatures are checked with the real HMAC code; only the HTTP calls are faked. */
class FakeGateway implements PaymentGateway {
  orders = new Map<string, { amount: number }>();
  payments = new Map<string, GatewayPayment>();
  captureCalls = 0;

  async createOrder({ amountPaise }: { amountPaise: number }) {
    const id = `order_fake_${crypto.randomBytes(6).toString('hex')}`;
    this.orders.set(id, { amount: amountPaise });
    return { id, amount: amountPaise, currency: 'INR', receipt: null, status: 'created' };
  }
  async fetchPayment(id: string) {
    const p = this.payments.get(id);
    if (!p) throw new Error('payment not found at gateway');
    return p;
  }
  async capturePayment(id: string) {
    this.captureCalls++;
    const p = { ...this.payments.get(id)!, status: 'captured' as const };
    this.payments.set(id, p);
    return p;
  }
  /** The customer completes checkout for an order: returns what Razorpay hands the browser. */
  pay(orderId: string, opts: Partial<GatewayPayment> = {}) {
    const paymentId = `pay_fake_${crypto.randomBytes(5).toString('hex')}`;
    this.payments.set(paymentId, {
      id: paymentId, order_id: orderId, amount: this.orders.get(orderId)!.amount, currency: 'INR',
      status: 'captured', method: 'upi', ...opts
    });
    return { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: sign(orderId, paymentId) };
  }
}

let f: Fixture;
let gw: FakeGateway;
let invId: number;
let n = 0;

before(async () => { f = await baseFixture(); });
after(() => { setGateway(null); closeServer(); });

/** A fresh Confirmed invoice for customer A: 1000 + 18% tax = 1180. */
beforeEach(() => {
  gw = new FakeGateway();
  setGateway(gw);
  const start = `2026-0${(n % 9) + 1}-01`;
  const subId = newSubscription({ customer: f.custA, plan: f.monthlyPlan, start, taxId: f.taxId, lines: [{ product: f.productId, unit: 1000 }] });
  n++;
  runBillingCycle(start, { autoConfirm: true });
  invId = queryOne<any>('SELECT id FROM invoices WHERE subscription_id = ? ORDER BY id LIMIT 1', [subId]).id;
});

const invoice = () => queryOne<any>('SELECT status, amount_paid FROM invoices WHERE id = ?', [invId]);
const paymentCount = () => queryOne<any>('SELECT COUNT(*) AS n FROM payments WHERE invoice_id = ?', [invId]).n;

test('razorpay: order amount is decided by the server and the payment settles the invoice', async () => {
  const order = await api('POST', '/payments/razorpay/create-order', f.a, { invoice_id: invId });
  assert.equal(order.status, 200);
  assert.equal(order.body.amountPaise, 118000);
  assert.equal(order.body.amountInr, 1180);
  assert.equal(order.body.keyId, process.env.RAZORPAY_KEY_ID);

  const checkout = gw.pay(order.body.orderId);
  const verify = await api('POST', '/payments/razorpay/verify-payment', f.a, checkout);
  assert.equal(verify.status, 200);
  assert.equal(invoice().status, 'Paid');
  assert.equal(invoice().amount_paid, 1180);

  const pay = queryOne<any>('SELECT payment_method, reference FROM payments WHERE invoice_id = ?', [invId]);
  assert.equal(pay.payment_method, 'UPI');
  assert.equal(pay.reference, `razorpay:${checkout.razorpay_payment_id}`);

  const again = await api('POST', '/payments/razorpay/create-order', f.a, { invoice_id: invId });
  assert.equal(again.status, 409, 'a paid invoice cannot be paid again');
});

test('razorpay: customers can part-pay online, then pay the rest', async () => {
  const first = await api('POST', '/payments/razorpay/create-order', f.a, { invoice_id: invId, amount: '400' });
  assert.equal(first.status, 200);
  assert.equal(first.body.amountPaise, 40000);
  await api('POST', '/payments/razorpay/verify-payment', f.a, gw.pay(first.body.orderId));
  assert.equal(invoice().status, 'Confirmed');
  assert.equal(invoice().amount_paid, 400);

  const rest = await api('POST', '/payments/razorpay/create-order', f.a, { invoice_id: invId });
  assert.equal(rest.body.amountInr, 780);
  await api('POST', '/payments/razorpay/verify-payment', f.a, gw.pay(rest.body.orderId));
  assert.equal(invoice().status, 'Paid');
  assert.equal(paymentCount(), 2);
});

test('razorpay: amounts above the balance, below 1.00 or leaving dust are refused', async () => {
  assert.equal((await api('POST', '/payments/razorpay/create-order', f.a, { invoice_id: invId, amount: '1180.01' })).status, 400);
  assert.equal((await api('POST', '/payments/razorpay/create-order', f.a, { invoice_id: invId, amount: '0.50' })).status, 400);
  assert.equal((await api('POST', '/payments/razorpay/create-order', f.a, { invoice_id: invId, amount: '1179.50' })).status, 400);
  assert.equal(gw.orders.size, 0, 'no gateway order was created for refused amounts');
});

test('razorpay: a forged, missing or foreign signature never marks anything paid', async () => {
  const order = await api('POST', '/payments/razorpay/create-order', f.a, { invoice_id: invId });
  const checkout = gw.pay(order.body.orderId);

  const forged = await api('POST', '/payments/razorpay/verify-payment', f.a, { ...checkout, razorpay_signature: 'deadbeef'.repeat(8) });
  assert.equal(forged.status, 400);
  const missing = await api('POST', '/payments/razorpay/verify-payment', f.a, { razorpay_order_id: checkout.razorpay_order_id, razorpay_payment_id: checkout.razorpay_payment_id });
  assert.equal(missing.status, 400);
  const otherPayment = await api('POST', '/payments/razorpay/verify-payment', f.a, {
    ...checkout, razorpay_payment_id: 'pay_someone_else', razorpay_signature: sign(checkout.razorpay_order_id, 'pay_x')
  });
  assert.equal(otherPayment.status, 400);

  assert.equal(invoice().status, 'Confirmed');
  assert.equal(invoice().amount_paid, 0);
  assert.equal(paymentCount(), 0);
  assert.ok(queryOne<any>("SELECT 1 AS x FROM audit_logs WHERE event_type = 'ONLINE_PAYMENT_REJECTED'"), 'rejections are audited');
});

test('razorpay: tenant isolation holds for creating and confirming orders', async () => {
  assert.equal((await api('POST', '/payments/razorpay/create-order', f.b, { invoice_id: invId })).status, 404);

  const order = await api('POST', '/payments/razorpay/create-order', f.a, { invoice_id: invId });
  const stolen = await api('POST', '/payments/razorpay/verify-payment', f.b, gw.pay(order.body.orderId));
  assert.equal(stolen.status, 404);
  assert.equal(invoice().status, 'Confirmed');
});

test('razorpay: confirming twice is idempotent and records one payment', async () => {
  const order = await api('POST', '/payments/razorpay/create-order', f.a, { invoice_id: invId });
  const checkout = gw.pay(order.body.orderId);
  const one = await api('POST', '/payments/razorpay/verify-payment', f.a, checkout);
  const two = await api('POST', '/payments/razorpay/verify-payment', f.a, checkout);
  assert.equal(one.status, 200);
  assert.equal(two.status, 200);
  assert.equal(two.body.payment.alreadyProcessed, true);
  assert.equal(paymentCount(), 1);
});

test('razorpay: the gateway is the source of truth for amount, order and capture state', async () => {
  const order = await api('POST', '/payments/razorpay/create-order', f.a, { invoice_id: invId });

  const wrongAmount = gw.pay(order.body.orderId, { amount: 100 });
  assert.equal((await api('POST', '/payments/razorpay/verify-payment', f.a, wrongAmount)).status, 400);

  const wrongOrder = gw.pay(order.body.orderId, { order_id: 'order_other' });
  assert.equal((await api('POST', '/payments/razorpay/verify-payment', f.a, wrongOrder)).status, 400);

  const failed = gw.pay(order.body.orderId, { status: 'failed' });
  assert.equal((await api('POST', '/payments/razorpay/verify-payment', f.a, failed)).status, 409);

  assert.equal(paymentCount(), 0);

  const authorized = gw.pay(order.body.orderId, { status: 'authorized' });
  assert.equal((await api('POST', '/payments/razorpay/verify-payment', f.a, authorized)).status, 200);
  assert.equal(gw.captureCalls, 1, 'authorized payments are captured');
  assert.equal(invoice().status, 'Paid');
});

test('razorpay: if staff settle the invoice first, the late online payment is flagged for refund', async () => {
  const order = await api('POST', '/payments/razorpay/create-order', f.a, { invoice_id: invId });
  const settle = await api('POST', '/payments', f.staff, { invoice_id: invId, amount: '1180', payment_method: 'Cash' });
  assert.equal(settle.status, 201);

  const late = await api('POST', '/payments/razorpay/verify-payment', f.a, gw.pay(order.body.orderId));
  assert.equal(late.status, 409);
  assert.equal(paymentCount(), 1, 'the invoice is not double-credited');
  assert.equal(queryOne<any>('SELECT status FROM payment_orders WHERE gateway_order_id = ?', [order.body.orderId]).status, 'failed');
  assert.ok(queryOne<any>("SELECT 1 AS x FROM audit_logs WHERE event_type = 'ONLINE_PAYMENT_NEEDS_REFUND'"));
});

test('razorpay webhook: a signed payment.captured settles a payment whose browser callback never arrived', async () => {
  const order = await api('POST', '/payments/razorpay/create-order', f.a, { invoice_id: invId });
  const checkout = gw.pay(order.body.orderId);
  const body = JSON.stringify({
    event: 'payment.captured',
    payload: { payment: { entity: { id: checkout.razorpay_payment_id, order_id: checkout.razorpay_order_id } } }
  });
  const post = (signature: string) => fetch(`${apiUrl()}/api/payments/razorpay/webhook`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-razorpay-signature': signature }, body
  });

  assert.equal((await post('0'.repeat(64))).status, 400, 'bad signature is refused');
  assert.equal(invoice().status, 'Confirmed');

  const good = crypto.createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');
  assert.equal((await post(good)).status, 200);
  assert.equal(invoice().status, 'Paid');

  assert.equal((await post(good)).status, 200, 'redelivery is harmless');
  assert.equal(paymentCount(), 1);

  // The browser callback arriving afterwards is also a no-op.
  const late = await api('POST', '/payments/razorpay/verify-payment', f.a, checkout);
  assert.equal(late.status, 200);
  assert.equal(paymentCount(), 1);
});

test('razorpay: without gateway credentials online payment is unavailable, never faked', async () => {
  const saved = process.env.RAZORPAY_KEY_SECRET;
  process.env.RAZORPAY_KEY_SECRET = '';
  try {
    assert.equal((await api('POST', '/payments/razorpay/create-order', f.a, { invoice_id: invId })).status, 503);
    assert.equal((await api('GET', '/payments/razorpay/config', f.a)).body.enabled, false);
  } finally {
    process.env.RAZORPAY_KEY_SECRET = saved;
  }
  assert.equal((await api('GET', '/payments/razorpay/config', f.a)).body.enabled, true);
  assert.equal(queryAll('SELECT id FROM payment_orders WHERE invoice_id = ? AND status = ?', [invId, 'created']).length, 0);
});

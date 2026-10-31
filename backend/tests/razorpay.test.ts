import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { api, baseFixture, closeServer, queryOne, Fixture, newSubscription } from './helpers.js';
import { runBillingCycle } from '../src/services/billingEngine.js';

let f: Fixture;
let subId: number;
let invId: number;

before(async () => {
  f = await baseFixture();
  subId = newSubscription({
    customer: f.custA,
    plan: f.monthlyPlan,
    start: '2026-01-01',
    taxId: f.taxId,
    lines: [{ product: f.productId, unit: 1000 }]
  });
  runBillingCycle('2026-01-01', { autoConfirm: true });
  invId = queryOne<any>('SELECT id FROM invoices WHERE subscription_id = ?', [subId]).id;
});
after(closeServer);

test('razorpay: customer initiates order and completes online payment', async () => {
  // 1. Customer A creates order for their invoice
  const orderRes = await api('POST', '/payments/razorpay/create-order', f.a, { invoice_id: invId });
  assert.equal(orderRes.status, 200);
  assert.ok(orderRes.body.orderId.startsWith('order_'));
  assert.equal(orderRes.body.amountInr, 1180); // 1000 + 18% tax

  // 2. Customer B cannot pay Customer A's invoice (Strict tenant isolation)
  const leakRes = await api('POST', '/payments/razorpay/create-order', f.b, { invoice_id: invId });
  assert.equal(leakRes.status, 404, 'Customer B gets 404 for Customer A invoice');

  // 3. Customer A verifies payment
  const verifyRes = await api('POST', '/payments/razorpay/verify-payment', f.a, {
    invoice_id: invId,
    razorpay_order_id: orderRes.body.orderId,
    razorpay_payment_id: 'pay_test_online_12345'
  });
  assert.equal(verifyRes.status, 200);

  // 4. Invoice is now Paid
  const inv = queryOne<any>('SELECT status, amount_paid FROM invoices WHERE id = ?', [invId]);
  assert.equal(inv.status, 'Paid');
  assert.equal(inv.amount_paid, 1180);

  // 5. Duplicate payment on already paid invoice is blocked
  const dupOrder = await api('POST', '/payments/razorpay/create-order', f.a, { invoice_id: invId });
  assert.equal(dupOrder.status, 400);
});

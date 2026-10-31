import { api, closeServer, execute, insertUser, queryOne, PASSWORD } from './helpers.js';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';

after(closeServer);

/**
 * The demo script as an automated, API-level test: every step a judge sees in the UI,
 * in the same order, against the real application (no mocks).
 */
test('demo story: login -> product/variant/plan -> subscription -> billing twice -> invoice -> payments -> customer view -> dashboard', async () => {
  insertUser('admin@demo.test', 'admin', 'Admin');
  const customerA = insertUser('acme@demo.test', 'customer', 'Acme');
  insertUser('globex@demo.test', 'customer', 'Globex');
  execute("INSERT INTO tax_rules (name, rate_percentage, is_default) VALUES ('GST 18%', 18, 1)");

  // 1. login
  const login = async (email: string) => (await api('POST', '/auth/login', null, { email, password: PASSWORD })).body.token as string;
  const admin = await login('admin@demo.test');
  const acme = await login('acme@demo.test');
  const globex = await login('globex@demo.test');
  assert.ok(admin && acme && globex);

  // 2-3. product 1000 with Odoo variant +560
  const product = await api('POST', '/catalog/products', admin, {
    name: 'ERP', type: 'software', sales_price: 1000, cost_price: 300,
    variants: [{ attribute_name: 'Brand', option_name: 'Odoo', price_extra: 560 }]
  });
  assert.equal(product.status, 201);
  const variantId = queryOne<any>('SELECT id FROM product_variants WHERE product_id = ?', [product.body.productId])!.id;

  // 4. plan
  const plan = await api('POST', '/catalog/plans', admin, { name: 'Monthly', billing_interval: 'monthly', price: 0, min_quantity: 1 });
  assert.equal(plan.status, 201);

  // 5-6. subscription: Draft -> Quotation -> Confirmed -> Active
  const sub = await api('POST', '/subscriptions', admin, {
    customer_id: customerA, plan_id: plan.body.planId, start_date: '2090-01-15', payment_terms: '30 Days Net',
    lines: [{ product_id: product.body.productId, variant_id: variantId, quantity: 2 }]
  });
  assert.equal(sub.status, 201);
  const subId = sub.body.subscription.id;
  assert.equal(queryOne<any>('SELECT unit_price FROM subscription_lines WHERE subscription_id = ?', [subId]).unit_price, 1560);
  for (const status of ['Quotation', 'Confirmed', 'Active']) {
    assert.equal((await api('PATCH', `/subscriptions/${subId}/status`, admin, { status })).status, 200);
  }

  // 7-9. billing: first run creates the three due months, second run creates none, integrity is clean
  const first = await api('POST', '/billing/run', admin, { as_of_date: '2090-03-20' });
  assert.equal(first.body.result.invoicesCreated, 3);
  const second = await api('POST', '/billing/run', admin, { as_of_date: '2090-03-20' });
  assert.equal(second.body.result.invoicesCreated, 0);
  const integrity = (await api('GET', '/billing/integrity', admin)).body.report;
  assert.deepEqual([integrity.duplicatePeriods, integrity.missingPeriods, integrity.ok], [0, 0, true]);

  // 10-11. open an invoice: 2 x 1560 = 3120, tax 18% = 561.60, total 3681.60
  assert.equal((await api('POST', '/billing/invoices/confirm-drafts', admin, {})).body.confirmed, 3);
  const list = await api('GET', '/billing/invoices', admin);
  const invoiceId = list.body.invoices.find((i: any) => i.period_start === '2090-01-15').id;
  const invoice = (await api('GET', `/billing/invoices/${invoiceId}`, admin)).body.invoice;
  assert.deepEqual([invoice.subtotal, invoice.tax_amount, invoice.total_amount, invoice.due_date], [3120, 561.6, 3681.6, '2090-04-19']);
  assert.equal(invoice.lines[0].tax_rate, 18);

  // 12-13. partial payment, then the rest: outstanding and Paid
  const part = await api('POST', '/payments', admin, { invoice_id: invoiceId, amount: '1000.60', payment_method: 'UPI' });
  assert.deepEqual([part.body.payment.amountPaid, part.body.payment.balanceRemaining, part.body.payment.status], [1000.6, 2681, 'Confirmed']);
  assert.equal((await api('POST', '/payments', admin, { invoice_id: invoiceId, amount: '2681.01', payment_method: 'UPI' })).status, 409);
  const rest = await api('POST', '/payments', admin, { invoice_id: invoiceId, amount: '2681', payment_method: 'Bank Transfer' });
  assert.deepEqual([rest.body.payment.balanceRemaining, rest.body.payment.status], [0, 'Paid']);

  // 14-15. customer portal: Acme sees its own data, Globex sees none of it (404)
  const mine = await api('GET', '/billing/invoices', acme);
  assert.equal(mine.body.invoices.length, 3);
  assert.equal((await api('GET', '/payments', acme)).body.payments.length, 2);
  assert.equal((await api('GET', `/billing/invoices/${invoiceId}`, globex)).status, 404);
  assert.equal((await api('GET', `/subscriptions/${subId}`, globex)).status, 404);
  assert.deepEqual((await api('GET', '/billing/invoices', globex)).body.invoices, []);

  // 16. finance dashboard matches the ledger
  const m = (await api('GET', '/analytics/summary', admin)).body.metrics;
  assert.equal(m.subscriptions.active, 1);
  assert.equal(m.financials.totalInvoiced, 3 * 3681.6);
  assert.equal(m.financials.totalCollected, 3681.6);
  assert.equal(m.financials.totalOwed, 2 * 3681.6);
  assert.equal(m.financials.overdueCount, 0, 'nothing is overdue yet');
});

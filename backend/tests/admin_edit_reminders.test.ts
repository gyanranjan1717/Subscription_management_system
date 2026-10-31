import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { api, baseFixture, closeServer, execute, queryOne, Fixture, newSubscription } from './helpers.js';
import { runBillingCycle } from '../src/services/billingEngine.js';

let f: Fixture;
let subId: number;
let invId: number;

before(async () => {
  f = await baseFixture();
  subId = newSubscription({ customer: f.custA, plan: f.monthlyPlan, start: '2026-01-01', taxId: f.taxId, lines: [{ product: f.productId, unit: 1000 }] });
  runBillingCycle('2026-01-01', { autoConfirm: true });
  invId = queryOne<any>('SELECT id FROM invoices WHERE subscription_id = ?', [subId]).id;
});
after(closeServer);

test('catalog edit: a price change never rewrites existing lines or invoices', async () => {
  const lineBefore = queryOne<any>('SELECT unit_price FROM subscription_lines WHERE subscription_id = ?', [subId]).unit_price;
  const res = await api('PATCH', `/catalog/products/${f.productId}`, f.admin, { sales_price: '1500', name: 'Cloud ERP Plus' });
  assert.equal(res.status, 200);
  assert.equal(queryOne<any>('SELECT sales_price, name FROM products WHERE id = ?', [f.productId]).sales_price, 1500);
  assert.equal(queryOne<any>('SELECT unit_price FROM subscription_lines WHERE subscription_id = ?', [subId]).unit_price, lineBefore);
  assert.equal(queryOne<any>('SELECT total_amount FROM invoices WHERE id = ?', [invId]).total_amount, 1180);
});

test('catalog edit: only admins can edit; staff and customers are refused', async () => {
  for (const token of [f.staff, f.a]) {
    assert.equal((await api('PATCH', `/catalog/products/${f.productId}`, token, { name: 'x' })).status, 403);
    assert.equal((await api('PATCH', `/catalog/plans/${f.monthlyPlan}`, token, { name: 'x' })).status, 403);
  }
  assert.equal((await api('PATCH', '/catalog/products/99999', f.admin, { name: 'x' })).status, 404);
  assert.equal((await api('PATCH', `/catalog/products/${f.productId}`, f.admin, {})).status, 400, 'empty edits are rejected');
});

test('catalog edit: variants can be repriced; the Odoo variant keeps its +560 until an admin changes it', async () => {
  assert.equal((await api('PATCH', `/catalog/variants/${f.odooVariant}`, f.admin, { price_extra: '600' })).status, 200);
  assert.equal(queryOne<any>('SELECT price_extra FROM product_variants WHERE id = ?', [f.odooVariant]).price_extra, 600);
  await api('PATCH', `/catalog/variants/${f.odooVariant}`, f.admin, { price_extra: '560' });
  assert.equal(queryOne<any>('SELECT price_extra FROM product_variants WHERE id = ?', [f.odooVariant]).price_extra, 560);
});

test('catalog edit: a plan keeps its billing interval, and its dates stay consistent', async () => {
  assert.equal((await api('PATCH', `/catalog/plans/${f.monthlyPlan}`, f.admin, { billing_interval: 'yearly' })).status, 400);
  assert.equal((await api('PATCH', `/catalog/plans/${f.monthlyPlan}`, f.admin, { start_date: '2026-06-01', end_date: '2026-01-01' })).status, 400);
  assert.equal((await api('PATCH', `/catalog/plans/${f.monthlyPlan}`, f.admin, { min_quantity: 3, can_pause: false })).status, 200);
  const plan = queryOne<any>('SELECT min_quantity, can_pause FROM plans WHERE id = ?', [f.monthlyPlan]);
  assert.equal(plan.min_quantity, 3);
  assert.equal(plan.can_pause, 0);
  await api('PATCH', `/catalog/plans/${f.monthlyPlan}`, f.admin, { min_quantity: 1, can_pause: true });
});

test('catalog edit: ending a discount hides it from pickers, and admins can bring it back', async () => {
  const created = await api('POST', '/catalog/discounts', f.admin, {
    code: 'EDITME', description: 'Edit me', discount_type: 'fixed', value: '50', applies_to: 'all', max_uses: 10
  });
  const id = created.body.discountId;
  const listed = async (token: string, q = '') =>
    ((await api('GET', `/catalog/discounts${q}`, token)).body.discounts as any[]).some(d => d.id === id);

  assert.equal(await listed(f.staff), true);
  assert.equal((await api('PATCH', `/catalog/discounts/${id}`, f.admin, { is_active: false })).status, 200);
  assert.equal(await listed(f.staff), false, 'inactive rules disappear for staff');
  assert.equal(await listed(f.admin), false);
  assert.equal(await listed(f.admin, '?include_inactive=true'), true, 'admins can still see archived rules');
  assert.equal(await listed(f.staff, '?include_inactive=true'), false, 'staff cannot ask for archived rules');

  await api('PATCH', `/catalog/discounts/${id}`, f.admin, { is_active: true });
  assert.equal(await listed(f.staff), true);

  execute('UPDATE discount_rules SET current_uses = 6 WHERE id = ?', [id]);
  assert.equal((await api('PATCH', `/catalog/discounts/${id}`, f.admin, { max_uses: 5 })).status, 400, 'cannot cap below uses already consumed');
  assert.equal((await api('PATCH', `/catalog/discounts/${id}`, f.admin, { max_uses: 50, value: '75' })).status, 200);
});

test('reminders: staff can chase an overdue invoice once a day; customers cannot', async () => {
  execute("UPDATE invoices SET due_date = '2026-01-15' WHERE id = ?", [invId]);

  assert.equal((await api('POST', `/billing/invoices/${invId}/remind`, f.a)).status, 403);

  const first = await api('POST', `/billing/invoices/${invId}/remind`, f.staff);
  assert.equal(first.status, 200);
  const mail = queryOne<any>("SELECT to_email, subject, body, delivery_status FROM email_outbox WHERE kind = 'REMINDER' ORDER BY id DESC");
  assert.equal(mail.to_email, 'a@test.com');
  assert.match(mail.subject, /Overdue/);
  assert.match(mail.body, /1,180\.00/);
  assert.ok(queryOne<any>("SELECT 1 AS x FROM audit_logs WHERE event_type = 'PAYMENT_REMINDER_SENT' AND invoice_id = ?", [invId]));

  assert.equal((await api('POST', `/billing/invoices/${invId}/remind`, f.staff)).status, 409, 'cooldown');

  const all = await api('POST', '/billing/invoices/remind-overdue', f.staff);
  assert.equal(all.status, 200);
  assert.equal(all.body.sent, 0);
  assert.ok(all.body.skipped >= 1);
});

test('reminders: paid or draft invoices are never chased; bulk run reaches every overdue invoice', async () => {
  const sub2 = newSubscription({ customer: f.custB, plan: f.monthlyPlan, start: '2026-02-01', taxId: f.taxId, lines: [{ product: f.productId, unit: 500 }] });
  runBillingCycle('2026-02-01', { autoConfirm: true });
  const inv2 = queryOne<any>('SELECT id FROM invoices WHERE subscription_id = ?', [sub2]).id;
  execute("UPDATE invoices SET due_date = '2026-02-10' WHERE id = ?", [inv2]);

  const bulk = await api('POST', '/billing/invoices/remind-overdue', f.admin);
  assert.equal(bulk.status, 200);
  const inv2Number = queryOne<any>('SELECT invoice_number FROM invoices WHERE id = ?', [inv2]).invoice_number;
  const inv1Number = queryOne<any>('SELECT invoice_number FROM invoices WHERE id = ?', [invId]).invoice_number;
  assert.ok(bulk.body.invoices.includes(inv2Number), 'the overdue invoice is chased');
  assert.ok(!bulk.body.invoices.includes(inv1Number), 'an invoice chased earlier today is skipped');

  execute("UPDATE invoices SET status = 'Paid', amount_paid = total_amount WHERE id = ?", [inv2]);
  execute("DELETE FROM audit_logs WHERE event_type = 'PAYMENT_REMINDER_SENT' AND invoice_id = ?", [inv2]);
  assert.equal((await api('POST', `/billing/invoices/${inv2}/remind`, f.staff)).status, 409);
});

test('dashboard: six-month invoiced/collected trend, oldest first, zero-filled', async () => {
  const res = await api('GET', '/analytics/summary', f.staff);
  assert.equal(res.status, 200);
  const trend = res.body.trend as Array<{ month: string; invoiced: number; collected: number }>;
  assert.equal(trend.length, 6);
  const months = trend.map(t => t.month);
  assert.deepEqual(months, [...months].sort());
  assert.match(months[5], /^\d{4}-\d{2}$/);
  for (const t of trend) {
    assert.equal(typeof t.invoiced, 'number');
    assert.equal(typeof t.collected, 'number');
  }
  assert.equal((await api('GET', '/analytics/summary', f.a)).status, 403, 'customers cannot read the dashboard');
});

import {
  api, baseFixture, closeServer, execute, getDb, invoicesOf, newDiscount, newPlan, newProduct, newSubscription, queryAll, queryOne, Fixture
} from './helpers.js';
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { runBillingCycle } from '../src/services/billingEngine.js';
import { buildIntegrityReport } from '../src/services/integrityService.js';
import { claimDiscountUse } from '../src/services/discountEngine.js';
import { transitionSubscription } from '../src/services/stateMachine.js';

let f: Fixture;
before(async () => { f = await baseFixture(); });
after(closeServer);

/** Other tests leave Active subscriptions behind; park them so a run's totals are about this test only. */
function only(...ids: number[]) {
  execute(`UPDATE subscriptions SET status = 'Closed' WHERE status = 'Active' AND id NOT IN (${ids.join(',')})`);
}
const lineOf = (unit: number, qty = 1, tax: number | null = null) => ({ product: f.productId, qty, unit, tax });

test('billing: first run creates the invoice, second run creates exactly zero, integrity is clean', () => {
  const sub = newSubscription({ customer: f.custA, plan: f.monthlyPlan, start: '2026-01-01', taxId: f.taxId, lines: [lineOf(1000)] });
  const first = runBillingCycle('2026-01-01');
  assert.equal(first.invoicesCreated, 1);
  const snapshot = JSON.stringify(invoicesOf(sub));

  const second = runBillingCycle('2026-01-01');
  assert.equal(second.invoicesCreated, 0);
  assert.equal(second.processedCount, 0); // cursor already moved past the date
  assert.equal(JSON.stringify(invoicesOf(sub)), snapshot, 'second run must not touch the first invoice');

  const report = buildIntegrityReport();
  assert.equal(report.duplicatePeriods, 0);
  assert.equal(report.missingPeriods, 0);
  assert.equal(report.ok, true);
});

test('billing: invoice carries tax per line, totals foot, due date follows payment terms', () => {
  const sub = newSubscription({ customer: f.custA, plan: f.monthlyPlan, start: '2026-02-01', terms: '30 Days Net', taxId: f.taxId, lines: [lineOf(1000), lineOf(33.33, 3)] });
  runBillingCycle('2026-02-01');
  const [inv] = invoicesOf(sub);
  assert.equal(inv.subtotal, 1099.99);
  assert.equal(inv.tax_amount, 198.0); // 180.00 + 18.00 (17.9982 -> 18.00)
  assert.equal(inv.discount_amount, 0);
  assert.equal(inv.total_amount, 1297.99);
  assert.equal(inv.status, 'Draft');
  assert.equal(inv.issue_date, '2026-02-01');
  assert.equal(inv.due_date, '2026-03-03'); // +30 days
  const lines = queryAll<any>('SELECT * FROM invoice_lines WHERE invoice_id = ?', [inv.id]);
  assert.equal(lines.length, 2);
  assert.equal(lines[0].tax_rate, 18);
  assert.equal(lines[0].tax_amount, 180);
  assert.equal(Math.round(lines.reduce((s, l) => s + l.line_total * 100, 0)), Math.round(inv.total_amount * 100));
});

test('billing: catch-up bills every missed period (Jan, Feb, Mar), never just the latest', () => {
  const sub = newSubscription({ customer: f.custB, plan: f.monthlyPlan, start: '2025-01-01', taxId: f.taxId, lines: [lineOf(100)] });
  const run = runBillingCycle('2025-03-15');
  assert.equal(run.invoicesCreated, 3);
  const invoices = invoicesOf(sub);
  assert.deepEqual(invoices.map(i => i.period_start), ['2025-01-01', '2025-02-01', '2025-03-01']);
  assert.deepEqual(invoices.map(i => i.period_end), ['2025-02-01', '2025-03-01', '2025-04-01']); // contiguous, no gaps
  assert.equal(queryOne<any>('SELECT next_billing_date AS d, next_period_index AS i FROM subscriptions WHERE id = ?', [sub]).d, '2025-04-01');
  assert.equal(runBillingCycle('2025-03-15').invoicesCreated, 0);
  assert.equal(buildIntegrityReport().missingPeriods, 0);
});

test('billing: future subscriptions and non-Active subscriptions are not billed', () => {
  const future = newSubscription({ customer: f.custA, plan: f.monthlyPlan, start: '2030-01-01', lines: [lineOf(10)] });
  const draft = newSubscription({ customer: f.custA, plan: f.monthlyPlan, start: '2024-01-01', status: 'Draft', lines: [lineOf(10)] });
  const paused = newSubscription({ customer: f.custA, plan: f.monthlyPlan, start: '2024-01-01', status: 'Paused', lines: [lineOf(10)] });
  runBillingCycle('2026-06-01');
  assert.equal(invoicesOf(future).length, 0);
  assert.equal(invoicesOf(draft).length, 0);
  assert.equal(invoicesOf(paused).length, 0);
});

test('billing: month-end start date stays on the 31st / clamps, yearly and weekly cadences', () => {
  const m = newSubscription({ customer: f.custA, plan: f.monthlyPlan, start: '2027-01-31', lines: [lineOf(10)] });
  runBillingCycle('2027-04-30');
  assert.deepEqual(invoicesOf(m).map(i => i.period_start), ['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30']);

  const y = newSubscription({ customer: f.custA, plan: newPlan('yearly'), start: '2024-02-29', lines: [lineOf(10)] });
  runBillingCycle('2026-03-01');
  assert.deepEqual(invoicesOf(y).map(i => i.period_start), ['2024-02-29', '2025-02-28', '2026-02-28']);

  const w = newSubscription({ customer: f.custA, plan: newPlan('weekly'), start: '2027-06-01', lines: [lineOf(10)] });
  runBillingCycle('2027-06-15');
  assert.deepEqual(invoicesOf(w).map(i => i.period_start), ['2027-06-01', '2027-06-08', '2027-06-15']);
});

test('billing: the database itself refuses a second invoice for the same subscription period', () => {
  const sub = newSubscription({ customer: f.custA, plan: f.monthlyPlan, start: '2028-01-01', lines: [lineOf(10)] });
  runBillingCycle('2028-01-01');
  const [inv] = invoicesOf(sub);
  assert.throws(
    () => execute(
      `INSERT INTO invoices (invoice_number, subscription_id, customer_id, period_index, period_start, period_end, subtotal, tax_amount, discount_amount, total_amount, status, issue_date, due_date)
       VALUES ('INV-DUP', ?, ?, 99, ?, '2028-02-01', 0, 0, 0, 0, 'Draft', '2028-01-01', '2028-01-01')`,
      [sub, f.custA, inv.period_start]
    ),
    /UNIQUE constraint failed/
  );
});

test('billing: a stale second runner (cursor rewound after a crash) re-detects existing invoices and creates nothing', () => {
  const sub = newSubscription({ customer: f.custA, plan: f.monthlyPlan, start: '2028-03-01', lines: [lineOf(10)] });
  runBillingCycle('2028-04-01'); // bills Mar + Apr
  assert.equal(invoicesOf(sub).length, 2);
  // Simulate a lost cursor update: another runner/crash left the cursor behind the invoices.
  execute("UPDATE subscriptions SET next_period_index = 0, next_billing_date = '2028-03-01' WHERE id = ?", [sub]);
  const rerun = runBillingCycle('2028-04-01');
  assert.equal(rerun.invoicesCreated, 0);
  assert.equal(rerun.skippedDuplicates, 2);
  assert.equal(invoicesOf(sub).length, 2);
  assert.equal(queryOne<any>('SELECT next_billing_date AS d FROM subscriptions WHERE id = ?', [sub]).d, '2028-05-01'); // self-heals
});

test('billing: a failure in the middle of a catch-up rolls back that subscription completely, others still bill', () => {
  const bad = newSubscription({ customer: f.custA, plan: f.monthlyPlan, start: '2029-01-01', lines: [{ product: newProduct(10, 'FAILME'), unit: 10 }] });
  const good = newSubscription({ customer: f.custB, plan: f.monthlyPlan, start: '2029-01-01', lines: [lineOf(10)] });
  only(bad, good);
  // Third period of the bad subscription blows up while its lines are inserted.
  getDb().exec(`CREATE TEMP TRIGGER fail_third BEFORE INSERT ON invoice_lines
    WHEN NEW.description LIKE 'FAILME%[2029-03-01%' BEGIN SELECT RAISE(ABORT, 'simulated failure'); END;`);
  const sequenceBefore = queryOne<any>("SELECT value FROM sequences WHERE name = 'invoice'").value;

  const run = runBillingCycle('2029-03-10');
  getDb().exec('DROP TRIGGER fail_third');

  assert.equal(run.errors, 1);
  assert.equal(invoicesOf(bad).length, 0, 'periods 1 and 2 must be rolled back with period 3');
  assert.equal(queryOne<any>('SELECT next_period_index AS i FROM subscriptions WHERE id = ?', [bad]).i, 0);
  assert.equal(invoicesOf(good).length, 3);
  assert.equal(run.invoicesCreated, 3, 'run totals only count committed work');
  assert.ok(queryOne<any>("SELECT value FROM sequences WHERE name = 'invoice'").value >= sequenceBefore + 3);

  // After the fault is gone the next run bills the bad subscription completely.
  assert.equal(runBillingCycle('2029-03-10').invoicesCreated, 3);
  assert.equal(buildIntegrityReport().ok, true);
});

test('billing: dry run reports the work but persists nothing', () => {
  const sub = newSubscription({ customer: f.custA, plan: f.monthlyPlan, start: '2031-01-01', lines: [lineOf(10)] });
  only(sub);
  const dry = runBillingCycle('2031-02-01', { dryRun: true });
  assert.equal(dry.invoicesCreated, 2);
  assert.equal(invoicesOf(sub).length, 0);
  assert.equal(queryOne<any>('SELECT next_period_index AS i FROM subscriptions WHERE id = ?', [sub]).i, 0);
  assert.equal(runBillingCycle('2031-02-01').invoicesCreated, 2);
});

test('billing: nothing is billed for periods starting on/after expiry; auto_close plans close themselves', () => {
  const plan = newPlan('monthly', { auto_close: 1 });
  const sub = newSubscription({ customer: f.custA, plan, start: '2032-01-01', expiry: '2032-03-01', lines: [lineOf(10)] });
  const run = runBillingCycle('2032-06-01');
  assert.deepEqual(invoicesOf(sub).map(i => i.period_start), ['2032-01-01', '2032-02-01']);
  assert.ok(run.details.some(d => d.status === 'auto_closed'));
  assert.equal(queryOne<any>('SELECT status FROM subscriptions WHERE id = ?', [sub]).status, 'Closed');

  const manual = newSubscription({ customer: f.custA, plan: f.monthlyPlan, start: '2032-01-01', expiry: '2032-03-01', lines: [lineOf(10)] });
  runBillingCycle('2032-06-01');
  assert.equal(invoicesOf(manual).length, 2);
  assert.equal(queryOne<any>('SELECT status FROM subscriptions WHERE id = ?', [manual]).status, 'Active', 'auto_close off: stays Active for follow-up');
});

test('billing: periods that start while paused are skipped on purpose and the integrity report accepts that', () => {
  const sub = newSubscription({ customer: f.custA, plan: f.monthlyPlan, start: '2033-01-01', lines: [lineOf(10)] });
  runBillingCycle('2033-01-15'); // January billed
  transitionSubscription(sub, 'Paused', f.adminId, '2033-01-20');
  transitionSubscription(sub, 'Active', f.adminId, '2033-03-10'); // Feb + Mar 1 started while paused
  only(sub);
  const run = runBillingCycle('2033-03-15');
  assert.equal(run.invoicesCreated, 0);
  runBillingCycle('2033-04-01');
  assert.deepEqual(invoicesOf(sub).map(i => i.period_start), ['2033-01-01', '2033-04-01']);
  const skips = queryAll<any>('SELECT period_index FROM subscription_period_skips WHERE subscription_id = ? ORDER BY 1', [sub]);
  assert.deepEqual(skips.map(s => s.period_index), [1, 2]);
  assert.equal(buildIntegrityReport().missingPeriods, 0);
});

test('integrity: detects a genuinely missing period and a tampered total', () => {
  const sub = newSubscription({ customer: f.custA, plan: f.monthlyPlan, start: '2034-01-01', lines: [lineOf(10)] });
  runBillingCycle('2034-03-01');
  getDb().exec('PRAGMA foreign_keys = OFF');
  execute("DELETE FROM invoice_lines WHERE invoice_id IN (SELECT id FROM invoices WHERE subscription_id = ? AND period_index = 1)", [sub]);
  execute('DELETE FROM invoices WHERE subscription_id = ? AND period_index = 1', [sub]);
  getDb().exec('PRAGMA foreign_keys = ON');
  const missing = buildIntegrityReport();
  assert.equal(missing.missingPeriods >= 1, true);
  assert.equal(missing.ok, false);
  // restore consistency for the remaining tests: remove the whole subscription's billing state
  execute('DELETE FROM invoice_lines WHERE invoice_id IN (SELECT id FROM invoices WHERE subscription_id = ?)', [sub]);
  execute('DELETE FROM invoices WHERE subscription_id = ?', [sub]);
  execute('UPDATE subscriptions SET status = ?, next_period_index = 0 WHERE id = ?', ['Closed', sub]);
  assert.equal(buildIntegrityReport().ok, true);
});

// ---- discounts ---------------------------------------------------------------------------------

function billOne(opts: { qty?: number; unit?: number; discountId: number; start: string; asOf?: string; extraLine?: boolean }) {
  const other = newProduct(500);
  const sub = newSubscription({
    customer: f.custA, plan: f.monthlyPlan, start: opts.start, taxId: f.taxId, discountId: opts.discountId,
    lines: [lineOf(opts.unit ?? 100, opts.qty ?? 1), ...(opts.extraLine ? [{ product: other, qty: 1, unit: 500, tax: f.taxId }] : [])]
  });
  runBillingCycle(opts.asOf ?? opts.start);
  return { sub, invoice: invoicesOf(sub)[0], other };
}

test('discount: percentage applies before tax and is stored; usage is recorded', () => {
  const d = newDiscount({ code: 'PCT20', type: 'percentage', value: 20 });
  const { invoice } = billOne({ unit: 100, qty: 10, discountId: d, start: '2035-01-01' });
  assert.equal(invoice.subtotal, 1000);
  assert.equal(invoice.discount_amount, 200);
  assert.equal(invoice.tax_amount, 144); // 18% of 800
  assert.equal(invoice.total_amount, 944);
  assert.equal(queryOne<any>('SELECT current_uses AS u FROM discount_rules WHERE id = ?', [d]).u, 1);
  assert.equal(queryAll<any>('SELECT * FROM invoice_discounts WHERE invoice_id = ?', [invoice.id]).length, 1);
});

test('discount: fixed amount is capped at the invoice value', () => {
  const d = newDiscount({ code: 'FIX500', type: 'fixed', value: 500 });
  const { invoice } = billOne({ unit: 100, qty: 3, discountId: d, start: '2035-02-01' });
  assert.equal(invoice.discount_amount, 300);
  assert.equal(invoice.total_amount, 0);
});

test('discount: minimum purchase and minimum quantity gate the discount', () => {
  const minAmount = newDiscount({ code: 'MINAMT', type: 'percentage', value: 10, minAmount: 1000 });
  assert.equal(billOne({ unit: 100, qty: 5, discountId: minAmount, start: '2035-03-01' }).invoice.discount_amount, 0);
  assert.equal(billOne({ unit: 100, qty: 10, discountId: minAmount, start: '2035-03-02' }).invoice.discount_amount, 100);

  const minQty = newDiscount({ code: 'MINQTY', type: 'percentage', value: 10, minQty: 5 });
  assert.equal(billOne({ unit: 100, qty: 4, discountId: minQty, start: '2035-03-03' }).invoice.discount_amount, 0);
  assert.equal(billOne({ unit: 100, qty: 5, discountId: minQty, start: '2035-03-04' }).invoice.discount_amount, 50);
});

test('discount: product-scoped rule discounts only that product, tax follows the discounted line', () => {
  const target = newProduct(700);
  const d = newDiscount({ code: 'PROD10', type: 'percentage', value: 10, scope: 'product', target });
  const sub = newSubscription({
    customer: f.custA, plan: f.monthlyPlan, start: '2035-04-01', taxId: f.taxId, discountId: d,
    lines: [{ product: target, unit: 700, qty: 1 }, lineOf(300)]
  });
  runBillingCycle('2035-04-01');
  const [inv] = invoicesOf(sub);
  assert.equal(inv.discount_amount, 70);
  const lines = queryAll<any>('SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY id', [inv.id]);
  assert.equal(lines[0].discount_amount, 70);
  assert.equal(lines[1].discount_amount, 0);
  assert.equal(inv.tax_amount, 167.4); // 18% of 630 + 18% of 300 = 113.4 + 54
  assert.equal(inv.total_amount, 1097.4);
});

test('discount: expired and not-yet-valid rules never apply', () => {
  const expired = newDiscount({ code: 'EXP', type: 'percentage', value: 50, start: '2020-01-01', end: '2020-12-31' });
  assert.equal(billOne({ discountId: expired, start: '2035-05-01' }).invoice.discount_amount, 0);
  const future = newDiscount({ code: 'FUT', type: 'percentage', value: 50, start: '2040-01-01' });
  assert.equal(billOne({ discountId: future, start: '2035-05-02' }).invoice.discount_amount, 0);
  assert.equal(queryOne<any>('SELECT current_uses AS u FROM discount_rules WHERE id = ?', [expired]).u, 0);
});

test('discount: usage limit stops the discount, detaches it, and the cap cannot be exceeded', () => {
  const d = newDiscount({ code: 'ONCE', type: 'percentage', value: 10, maxUses: 2 });
  const sub = newSubscription({ customer: f.custA, plan: f.monthlyPlan, start: '2036-01-01', discountId: d, lines: [lineOf(100)] });
  runBillingCycle('2036-04-01'); // four periods
  const invoices = invoicesOf(sub);
  assert.deepEqual(invoices.map(i => i.discount_amount), [10, 10, 0, 0]);
  assert.equal(queryOne<any>('SELECT current_uses AS u FROM discount_rules WHERE id = ?', [d]).u, 2);
  assert.equal(queryOne<any>('SELECT discount_rule_id AS d FROM subscriptions WHERE id = ?', [sub]).d, null);

  // The claim itself is the guard: with one use left, only one of two claimers wins.
  const last = newDiscount({ code: 'LASTONE', type: 'fixed', value: 5, maxUses: 1 });
  assert.equal(claimDiscountUse(last), true);
  assert.equal(claimDiscountUse(last), false);
  assert.throws(() => execute('UPDATE discount_rules SET current_uses = 5 WHERE id = ?', [last]), /CHECK constraint/);
});

test('discount: a rule is judged at each period start, so catch-up matches on-time billing, and stops after its end date', () => {
  const d = newDiscount({ code: 'ENDS', type: 'percentage', value: 10, end: '2037-02-01' });
  const sub = newSubscription({ customer: f.custA, plan: f.monthlyPlan, start: '2037-01-01', discountId: d, lines: [lineOf(100)] });
  runBillingCycle('2037-03-01');
  assert.deepEqual(invoicesOf(sub).map(i => i.discount_amount), [10, 10, 0]);
});

// ---- price snapshot ----------------------------------------------------------------------------

test('pricing: variant extra is added once, copied to the line, and later product price changes do not rewrite history', async () => {
  const created = await api('POST', '/subscriptions', f.admin, {
    customer_id: f.custA, plan_id: f.monthlyPlan, start_date: '2038-01-01',
    lines: [{ product_id: f.productId, variant_id: f.odooVariant, quantity: 1, tax_id: f.taxId }]
  });
  assert.equal(created.status, 201);
  const subId = created.body.subscription.id;
  const line = () => queryOne<any>('SELECT unit_price FROM subscription_lines WHERE subscription_id = ?', [subId]);
  assert.equal(line().unit_price, 1560);

  execute('UPDATE subscription_lines SET tax_id = ? WHERE subscription_id = ?', [f.taxId, subId]);
  execute("UPDATE subscriptions SET status = 'Active' WHERE id = ?", [subId]);
  runBillingCycle('2038-01-01');
  execute('UPDATE products SET sales_price = 1200 WHERE id = ?', [f.productId]);
  execute('UPDATE product_variants SET price_extra = 999 WHERE id = ?', [f.odooVariant]);
  runBillingCycle('2038-02-01');

  assert.equal(line().unit_price, 1560, 'subscription line keeps its snapshot');
  const unitPrices = queryAll<any>(
    'SELECT il.unit_price FROM invoice_lines il JOIN invoices i ON i.id = il.invoice_id WHERE i.subscription_id = ? ORDER BY i.period_index', [subId]
  ).map(r => r.unit_price);
  assert.deepEqual(unitPrices, [1560, 1560]);
  execute('UPDATE products SET sales_price = 1000 WHERE id = ?', [f.productId]);
  execute('UPDATE product_variants SET price_extra = 560 WHERE id = ?', [f.odooVariant]);
});

test('pricing: a product with variants requires a variant; a variant from another product is rejected', async () => {
  const noVariant = await api('POST', '/subscriptions', f.admin, {
    customer_id: f.custA, plan_id: f.monthlyPlan, start_date: '2038-01-01', lines: [{ product_id: f.productId, quantity: 1 }]
  });
  assert.equal(noVariant.status, 400);
  const other = newProduct(50);
  const wrong = await api('POST', '/subscriptions', f.admin, {
    customer_id: f.custA, plan_id: f.monthlyPlan, start_date: '2038-01-01', lines: [{ product_id: other, variant_id: f.odooVariant, quantity: 1 }]
  });
  assert.equal(wrong.status, 400);
});

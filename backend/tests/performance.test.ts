import { api, baseFixture, closeServer, getDb, queryOne, Fixture, execute } from './helpers.js';
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { runBillingCycle } from '../src/services/billingEngine.js';
import { buildIntegrityReport } from '../src/services/integrityService.js';

const SUBS = 3000;
let f: Fixture;

before(async () => {
  f = await baseFixture();
  const db = getDb();
  // Bulk-insert subscriptions: 3 monthly lines each, 3 months behind => 9,000 invoices on the catch-up run.
  db.exec('BEGIN');
  const insSub = db.prepare(
    `INSERT INTO subscriptions (subscription_number, customer_id, plan_id, status, start_date, next_period_index, next_billing_date, payment_terms)
     VALUES (?, ?, ?, 'Active', '2026-01-01', 0, '2026-01-01', '30 Days Net')`
  );
  const insLine = db.prepare(
    'INSERT INTO subscription_lines (subscription_id, product_id, quantity, unit_price, tax_id, line_amount) VALUES (?, ?, ?, ?, ?, ?)'
  );
  for (let i = 0; i < SUBS; i++) {
    const id = Number(insSub.run(`SUB-P-${i}`, i % 2 ? f.custA : f.custB, f.monthlyPlan).lastInsertRowid);
    for (let l = 1; l <= 3; l++) insLine.run(id, f.productId, l, 10 * l + 0.33, f.taxId, Math.round((10 * l + 0.33) * l * 100) / 100);
  }
  db.exec('COMMIT');
});
after(closeServer);

const timed = async <T>(fn: () => Promise<T> | T): Promise<[T, number]> => {
  const t = performance.now();
  const r = await fn();
  return [r, performance.now() - t];
};

test(`performance: billing ${SUBS} due subscriptions (3 periods each) is exact, idempotent and clean`, async () => {
  const [first, ms] = await timed(() => runBillingCycle('2026-03-15', { autoConfirm: true }));
  console.log(`      billing run: ${first.invoicesCreated} invoices for ${SUBS} subscriptions in ${ms.toFixed(0)} ms`);
  assert.equal(first.invoicesCreated, SUBS * 3);
  assert.equal(first.errors, 0);
  const [second] = await timed(() => runBillingCycle('2026-03-15'));
  assert.equal(second.invoicesCreated, 0);
  const [report, rms] = await timed(() => buildIntegrityReport());
  console.log(`      integrity report over ${SUBS * 3} invoices: ${rms.toFixed(0)} ms`);
  assert.equal(report.ok, true);
  assert.ok(rms < 2000);
});

test('performance: list and dashboard endpoints answer in under 2 seconds with thousands of records', async () => {
  for (const inv of [1, 2, 3]) {
    // some payments so aggregates have something to chew on
    execute("INSERT INTO payments (invoice_id, amount, payment_method, payment_date) VALUES (?, 1, 'Cash', '2026-03-16')", [inv]);
  }
  const cases: Array<[string, string, string]> = [
    ['dashboard summary', '/analytics/summary', f.staff],
    ['subscriptions (page 1)', '/subscriptions?page=1&page_size=50', f.staff],
    ['subscriptions by status', '/subscriptions?status=Active&page=1', f.staff],
    ['invoices (page 1)', '/billing/invoices?page=1&page_size=50', f.staff],
    ['overdue invoices', '/billing/invoices?overdue=true&page=1', f.staff],
    ['customer portal invoices', '/billing/invoices?page=1', f.a],
    ['integrity report', '/billing/integrity', f.staff]
  ];
  for (const [name, path, token] of cases) {
    const [res, ms] = await timed(() => api('GET', path, token));
    console.log(`      ${name}: ${ms.toFixed(0)} ms (${res.status})`);
    assert.equal(res.status, 200, name);
    assert.ok(ms < 2000, `${name} took ${ms.toFixed(0)} ms`);
  }
});

test('performance: key queries use indexes (no full table scans on the hot paths)', () => {
  const plan = (sql: string, ...p: (string | number)[]) =>
    (getDb().prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...p) as Array<{ detail: string }>).map(r => r.detail).join(' | ');
  const due = plan("SELECT id FROM subscriptions WHERE status = 'Active' AND next_billing_date <= ?", '2026-03-15');
  assert.match(due, /idx_subscriptions_status_billing/);
  const mine = plan('SELECT id FROM invoices WHERE customer_id = ? ORDER BY id DESC LIMIT 50', f.custA);
  assert.match(mine, /idx_invoices_customer/);
  const overdue = plan("SELECT id FROM invoices WHERE status = 'Confirmed' AND due_date < ?", '2026-01-01');
  assert.match(overdue, /idx_invoices_status_due/);
  const byInvoice = plan('SELECT id FROM payments WHERE invoice_id = ?', 1);
  assert.match(byInvoice, /idx_payments_invoice/);
  const period = plan('SELECT id FROM invoices WHERE subscription_id = ? AND period_start = ?', 1, '2026-01-01');
  assert.match(period, /USING (COVERING )?INDEX/);
  assert.ok(queryOne<{ n: number }>('SELECT COUNT(*) AS n FROM invoices')!.n >= SUBS * 3);
});

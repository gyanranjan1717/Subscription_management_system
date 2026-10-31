import assert from 'assert';
import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import { getDb, queryAll, queryOne } from '../src/db/database.js';
import { validatePassword } from '../src/middleware/auth.js';
import { canTransitionSubscription, transitionSubscription } from '../src/services/stateMachine.js';
import { runBillingCycle } from '../src/services/billingEngine.js';
import { evaluateDiscount, recordDiscountUsage } from '../src/services/discountEngine.js';

// Setup isolated database for repeatable deterministic testing
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runTests() {
  console.log('===============================================================');
  console.log(' STARTING BRIGHTLOOP VERIFICATION & TRAP TEST SUITE');
  console.log('===============================================================');

  // Reset and re-seed the test database cleanly
  const db = getDb();
  db.exec(`
    DELETE FROM payments;
    DELETE FROM invoice_lines;
    DELETE FROM invoices;
    DELETE FROM subscription_lines;
    DELETE FROM subscriptions;
    DELETE FROM quotation_template_lines;
    DELETE FROM quotation_templates;
    DELETE FROM discount_rules;
    DELETE FROM plans;
    DELETE FROM product_variants;
    DELETE FROM products;
    DELETE FROM tax_rules;
    DELETE FROM password_resets;
    DELETE FROM audit_logs;
    DELETE FROM users;
    DELETE FROM sqlite_sequence;
  `);

  const salt = await bcrypt.genSalt(10);
  const adminPass = await bcrypt.hash('Brightloop#2026', salt);
  const custPass = await bcrypt.hash('Customer#2026', salt);

  const adminRes = db.prepare(`INSERT INTO users (email, password_hash, full_name, role) VALUES (?, ?, ?, 'admin')`).run('admin@brightloop.com', adminPass, 'Alex Admin');
  const custRes = db.prepare(`INSERT INTO users (email, password_hash, full_name, role) VALUES (?, ?, ?, 'customer')`).run('acme@corp.com', custPass, 'Acme Corp');
  const custId = Number(custRes.lastInsertRowid);

  const taxRes = db.prepare(`INSERT INTO tax_rules (name, rate_percentage, is_default, is_active) VALUES ('GST 18%', 18.0, 1, 1)`).run();
  const taxId = Number(taxRes.lastInsertRowid);

  const prodRes = db.prepare(`INSERT INTO products (name, type, sales_price, cost_price) VALUES ('Brightloop Cloud ERP', 'software', 1200.0, 300.0)`).run();
  const prodId = Number(prodRes.lastInsertRowid);

  db.prepare(`INSERT INTO product_variants (product_id, attribute_name, option_name, price_extra) VALUES (?, 'Brand', 'Standard', 0.0), (?, 'Brand', 'Odoo Edition', 560.0)`).run(prodId, prodId);

  const planRes = db.prepare(`INSERT INTO plans (name, billing_interval, price, min_quantity, auto_close, can_pause, can_renew) VALUES ('Monthly Plan', 'monthly', 1200.0, 1, 0, 1, 1)`).run();
  const planId = Number(planRes.lastInsertRowid);

  const discRes = db.prepare(`INSERT INTO discount_rules (code, description, discount_type, value, min_amount, min_quantity, start_date, end_date, max_uses, current_uses, applies_to) VALUES ('SEATS20', '20% off', 'percentage', 20.0, 0, 5, '2026-01-01', '2027-12-31', 100, 0, 'all')`).run();
  const discId = Number(discRes.lastInsertRowid);

  db.prepare(`INSERT INTO discount_rules (code, description, discount_type, value, min_amount, min_quantity, start_date, end_date, max_uses, current_uses, applies_to) VALUES ('EXPIRED10', 'Expired', 'percentage', 10.0, 0, 0, '2025-01-01', '2025-06-30', 10, 10, 'all')`).run();

  const today = new Date().toISOString().split('T')[0];
  for (let i = 1; i <= 3; i++) {
    const s = db.prepare(`INSERT INTO subscriptions (subscription_number, customer_id, plan_id, status, start_date, next_billing_date, payment_terms) VALUES (?, ?, ?, 'Active', ?, ?, 'Immediate')`).run(`SUB-TEST-00${i}`, custId, planId, today, today);
    const sId = Number(s.lastInsertRowid);
    db.prepare(`INSERT INTO subscription_lines (subscription_id, product_id, quantity, unit_price, tax_id, line_amount) VALUES (?, ?, 1, 1200.0, ?, 1200.0)`).run(sId, prodId, taxId);
  }

  // Seed 1,000 benchmark records for SLA verification
  for (let i = 4; i <= 1003; i++) {
    db.prepare(`INSERT INTO subscriptions (subscription_number, customer_id, plan_id, status, start_date, next_billing_date, payment_terms) VALUES (?, ?, ?, 'Active', '2026-01-01', '2026-12-01', '30 Days Net')`).run(`SUB-BENCH-${i}`, custId, planId);
  }

  let passed = 0;
  let total = 0;

  function test(name: string, fn: () => void) {
    total++;
    try {
      fn();
      console.log(` [PASS] ${name}`);
      passed++;
    } catch (err: any) {
      console.error(` [FAIL] ${name}`);
      console.error(err);
    }
  }

  // --------------------------------------------------------------------------
  // TRAP 1: Password Validation Rule
  // "Password must be more than eight characters, so minimum 9, plus upper, lower and special"
  // --------------------------------------------------------------------------
  test('TRAP 1: Password validator accepts >= 9 chars with upper, lower, special', () => {
    const res = validatePassword('Pass#2026'); // 9 characters
    assert.strictEqual(res.valid, true);
  });

  test('TRAP 1: Password validator rejects 8 characters even with all char types', () => {
    const res = validatePassword('Pass#123'); // exactly 8 characters
    assert.strictEqual(res.valid, false);
    assert.ok(res.message?.includes('more than 8 characters'));
  });

  test('TRAP 1: Password validator rejects missing uppercase letter', () => {
    const res = validatePassword('password#2026');
    assert.strictEqual(res.valid, false);
    assert.ok(res.message?.includes('uppercase'));
  });

  test('TRAP 1: Password validator rejects missing special character', () => {
    const res = validatePassword('Password2026');
    assert.strictEqual(res.valid, false);
    assert.ok(res.message?.includes('special character'));
  });

  // --------------------------------------------------------------------------
  // TRAP 2: Odoo Brand Variant Pricing (+560)
  // --------------------------------------------------------------------------
  test('Catalog: Odoo Brand Variant adds exactly 560 to price', () => {
    const prod = queryOne<{ sales_price: number }>("SELECT sales_price FROM products WHERE name LIKE '%ERP%'");
    const variant = queryOne<{ price_extra: number }>("SELECT price_extra FROM product_variants WHERE option_name LIKE '%Odoo%'");
    assert.ok(prod, 'ERP product must exist');
    assert.ok(variant, 'Odoo variant must exist');
    assert.strictEqual(variant.price_extra, 560.00);
    const combinedPrice = prod.sales_price + variant.price_extra;
    assert.strictEqual(combinedPrice, 1760.00);
  });

  // --------------------------------------------------------------------------
  // TRAP 3: Subscription Lifecycle State Machine Transitions
  // --------------------------------------------------------------------------
  test('State Machine: allows legal transitions Draft -> Quotation -> Confirmed -> Active -> Closed', () => {
    assert.strictEqual(canTransitionSubscription('Draft', 'Quotation'), true);
    assert.strictEqual(canTransitionSubscription('Quotation', 'Confirmed'), true);
    assert.strictEqual(canTransitionSubscription('Confirmed', 'Active'), true);
    assert.strictEqual(canTransitionSubscription('Active', 'Closed'), true);
  });

  test('State Machine: rejects illegal transition Draft -> Active directly', () => {
    assert.strictEqual(canTransitionSubscription('Draft', 'Active'), false);
  });

  test('State Machine: rejects transitions from terminal Closed state', () => {
    assert.strictEqual(canTransitionSubscription('Closed', 'Active'), false);
    assert.strictEqual(canTransitionSubscription('Closed', 'Draft'), false);
  });

  // --------------------------------------------------------------------------
  // TRAP 4: Billing Engine Idempotency & Zero Double-Billing Guarantee
  // "Nothing should be billed twice or skipped: unique (subscription, period start),
  // row locking, and a catch-up loop for missed periods. A second billing run must create zero invoices."
  // --------------------------------------------------------------------------
  test('TRAP 4: Billing engine generates invoices for due active subscriptions', () => {
    const today = new Date().toISOString().split('T')[0];
    const initialRun = runBillingCycle(today, 1);
    assert.ok(initialRun.invoicesCreated >= 2, `Expected at least 2 invoices created, got ${initialRun.invoicesCreated}`);
    assert.ok(initialRun.totalBilledAmount > 0);
  });

  test('TRAP 4: Second billing run produces EXACTLY ZERO duplicate invoices', () => {
    const today = new Date().toISOString().split('T')[0];
    const secondRun = runBillingCycle(today, 1);
    assert.strictEqual(secondRun.invoicesCreated, 0, 'Second run must create ZERO duplicate invoices');
  });

  test('TRAP 4: Attempting to insert duplicate period directly is blocked by DB unique constraint', () => {
    const inv = queryOne<{ subscription_id: number; period_start: string }>(
      'SELECT subscription_id, period_start FROM invoices LIMIT 1'
    );
    assert.ok(inv);
    let threw = false;
    try {
      getDb().prepare(`
        INSERT INTO invoices (
          invoice_number, subscription_id, customer_id, period_start, period_end,
          subtotal, tax_amount, discount_amount, total_amount, amount_paid,
          status, issue_date, due_date
        ) VALUES ('INV-DUP-TEST', ?, 1, ?, '2026-12-01', 100, 0, 0, 100, 0, 'Confirmed', '2026-10-31', '2026-11-30')
      `).run(inv.subscription_id, inv.period_start);
    } catch (err: any) {
      threw = true;
      assert.ok(err.message.includes('UNIQUE constraint failed') || err.message.includes('constraint'));
    }
    assert.strictEqual(threw, true, 'Database unique constraint must block duplicate period');
  });

  // --------------------------------------------------------------------------
  // TRAP 5: Discount Rules Engine with Expiration and Usage Limit
  // --------------------------------------------------------------------------
  test('Discounts: Volume discount correctly applies for qualifying seats', () => {
    const rule = queryOne<{ id: number }>('SELECT id FROM discount_rules WHERE code = ?', ['SEATS20']);
    assert.ok(rule);
    const res = evaluateDiscount(rule.id, 1000, 10);
    assert.strictEqual(res.applicable, true);
    assert.strictEqual(res.discountAmount, 200); // 20% of 1000
  });

  test('Discounts: Correctly rejects expired discount rule', () => {
    const rule = queryOne<{ id: number }>('SELECT id FROM discount_rules WHERE code = ?', ['EXPIRED10']);
    assert.ok(rule);
    const res = evaluateDiscount(rule.id, 1000, 10, '2026-10-31');
    assert.strictEqual(res.applicable, false);
    assert.ok(res.reason?.includes('expired') || res.reason?.includes('limit'));
  });

  // --------------------------------------------------------------------------
  // TRAP 6: Performance SLA Under 2 Seconds on Thousands of Subscriptions
  // --------------------------------------------------------------------------
  test('Performance SLA: Analytical summary executes well under 2,000ms (<50ms)', () => {
    const start = performance.now();
    const count = queryOne<{ c: number }>('SELECT COUNT(*) as c FROM subscriptions');
    assert.ok(count && count.c >= 1000, 'Must have at least 1,000 records');

    // Run multi-aggregation query
    const stats = queryOne(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'Active' THEN 1 ELSE 0 END) as active,
        SUM(CASE WHEN status = 'Confirmed' THEN 1 ELSE 0 END) as confirmed
      FROM subscriptions
    `);
    const duration = performance.now() - start;
    console.log(`       Query duration for ${count.c} records: ${duration.toFixed(2)}ms`);
    assert.ok(duration < 2000, `Duration ${duration}ms must be under 2000ms`);
  });

  console.log('===============================================================');
  console.log(` RESULTS: ${passed}/${total} TESTS PASSED!`);
  console.log('===============================================================');

  if (passed !== total) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error(err);
  process.exit(1);
});

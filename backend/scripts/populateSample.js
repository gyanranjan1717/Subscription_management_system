const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');
const path = require('path');

const dbPath = path.resolve(__dirname, '../data/brightloop.sqlite');
const db = new DatabaseSync(dbPath);

console.log('Populating sample data into:', dbPath);

db.exec('PRAGMA foreign_keys = OFF;');

// 1. Staff user
const staffHash = bcrypt.hashSync('Staff#2026!', 10);
const existingStaff = db.prepare('SELECT id FROM users WHERE email = ?').get('staff@brightloop.io');
if (!existingStaff) {
  db.prepare(`
    INSERT INTO users (email, password_hash, full_name, role, phone, company_name)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run('staff@brightloop.io', staffHash, 'Sarah Jenkins (Billing Ops)', 'staff', '+91 98765 43210', 'Brightloop Operations');
}

// 2. Taxes
db.exec('DELETE FROM tax_rules;');
const gst = Number(db.prepare(`
  INSERT INTO tax_rules (name, rate_percentage, is_default, is_active)
  VALUES ('Standard GST (18%)', 18, 1, 1)
`).run().lastInsertRowid);

db.prepare(`
  INSERT INTO tax_rules (name, rate_percentage, is_default, is_active)
  VALUES ('Reduced Rate (5%)', 5, 0, 1)
`).run();

// 3. Products & Variants
db.exec('DELETE FROM product_variants;');
db.exec('DELETE FROM products;');

const p1 = Number(db.prepare(`
  INSERT INTO products (name, type, sales_price, cost_price, notes)
  VALUES ('Brightloop Core ERP Platform', 'software', 1200, 300, 'Flagship enterprise subscription software')
`).run().lastInsertRowid);

const stdVariant = Number(db.prepare(`
  INSERT INTO product_variants (product_id, attribute_name, option_name, price_extra)
  VALUES (?, 'Edition', 'Standard Edition', 0)
`).run(p1).lastInsertRowid);

const odooVariant = Number(db.prepare(`
  INSERT INTO product_variants (product_id, attribute_name, option_name, price_extra)
  VALUES (?, 'Edition', 'Odoo Certified Edition', 560)
`).run(p1).lastInsertRowid);

const p2 = Number(db.prepare(`
  INSERT INTO products (name, type, sales_price, cost_price, notes)
  VALUES ('24/7 Priority Support SLA', 'service', 500, 100, 'Dedicated TAM & 1-hour SLA response')
`).run().lastInsertRowid);

// 4. Plans
db.exec('DELETE FROM plans;');
const monthlyPlan = Number(db.prepare(`
  INSERT INTO plans (name, billing_interval, price, min_quantity, auto_close, can_close_early, can_pause, can_renew, is_active)
  VALUES ('Monthly Professional', 'monthly', 1200, 1, 0, 1, 1, 1, 1)
`).run().lastInsertRowid);

const yearlyPlan = Number(db.prepare(`
  INSERT INTO plans (name, billing_interval, price, min_quantity, auto_close, can_close_early, can_pause, can_renew, is_active)
  VALUES ('Yearly Enterprise', 'yearly', 12000, 1, 0, 1, 1, 1, 1)
`).run().lastInsertRowid);

// 5. Customer Gyan Ranjan
const customer = db.prepare("SELECT id FROM users WHERE email = 'rgyan931@gmail.com'").get();
if (!customer) {
  console.error("Customer rgyan931@gmail.com not found!");
  process.exit(1);
}
const custId = customer.id;

// 6. Subscriptions
db.exec('DELETE FROM subscription_lines;');
db.exec('DELETE FROM subscriptions;');
db.exec('DELETE FROM invoice_lines;');
db.exec('DELETE FROM invoices;');
db.exec('DELETE FROM payments;');

// Sub 1: Active Subscription for Gyan Ranjan
const sub1 = Number(db.prepare(`
  INSERT INTO subscriptions (subscription_number, customer_id, plan_id, status, start_date, expiry_date, next_period_index, next_billing_date, payment_terms, notes)
  VALUES ('SUB-2026-000001', ?, ?, 'Active', '2026-09-01', '2027-09-01', 1, '2026-10-01', 'Immediate Payment', 'Standard Cloud SaaS Agreement')
`).run(custId, monthlyPlan).lastInsertRowid);

db.prepare(`
  INSERT INTO subscription_lines (subscription_id, product_id, variant_id, quantity, unit_price, tax_id, line_amount)
  VALUES (?, ?, ?, 1, 1760.00, ?, 1760.00)
`).run(sub1, p1, odooVariant, gst);

db.prepare(`
  INSERT INTO subscription_lines (subscription_id, product_id, variant_id, quantity, unit_price, tax_id, line_amount)
  VALUES (?, ?, NULL, 1, 500.00, ?, 500.00)
`).run(sub1, p2, gst);

// Sub 2: Quotation proposal
const sub2 = Number(db.prepare(`
  INSERT INTO subscriptions (subscription_number, customer_id, plan_id, status, start_date, expiry_date, next_period_index, next_billing_date, payment_terms, quotation_sent_on, quotation_valid_until, notes)
  VALUES ('SUB-2026-000002', ?, ?, 'Quotation', '2026-10-31', '2027-10-31', 0, '2026-10-31', '30 Days Net', '2026-10-31', '2026-11-30', 'Yearly expansion proposal')
`).run(custId, yearlyPlan).lastInsertRowid);

db.prepare(`
  INSERT INTO subscription_lines (subscription_id, product_id, variant_id, quantity, unit_price, tax_id, line_amount)
  VALUES (?, ?, ?, 1, 1200.00, ?, 1200.00)
`).run(sub2, p1, stdVariant, gst);

// 7. Invoice for Sub 1 (INV-2026-000001) - Confirmed with balance due
// Subtotal: 1760 + 500 = 2260. Tax: 406.80. Total: 2666.80
const inv = Number(db.prepare(`
  INSERT INTO invoices (
    invoice_number, subscription_id, customer_id, period_index, period_start, period_end,
    subtotal, tax_amount, discount_amount, total_amount, amount_paid, status, issue_date, due_date
  ) VALUES (
    'INV-2026-000001', ?, ?, 0, '2026-09-01', '2026-09-30',
    2260.00, 406.80, 0.00, 2666.80, 0.00, 'Confirmed', '2026-09-01', '2026-10-15'
  )
`).run(sub1, custId).lastInsertRowid);

db.prepare(`
  INSERT INTO invoice_lines (
    invoice_id, kind, product_id, variant_id, description, quantity, unit_price,
    gross_amount, discount_amount, net_amount, tax_name, tax_rate, tax_amount, line_total
  ) VALUES (
    ?, 'PRODUCT', ?, ?, 'Brightloop Core ERP Platform (Edition: Odoo Certified Edition) [2026-09-01 to 2026-09-30]', 1, 1760.00,
    1760.00, 0.00, 1760.00, 'Standard GST (18%)', 18, 316.80, 2076.80
  )
`).run(inv, p1, odooVariant);

db.prepare(`
  INSERT INTO invoice_lines (
    invoice_id, kind, product_id, variant_id, description, quantity, unit_price,
    gross_amount, discount_amount, net_amount, tax_name, tax_rate, tax_amount, line_total
  ) VALUES (
    ?, 'PRODUCT', ?, NULL, '24/7 Priority Support SLA [2026-09-01 to 2026-09-30]', 1, 500.00,
    500.00, 0.00, 500.00, 'Standard GST (18%)', 18, 90.00, 590.00
  )
`).run(inv, p2);

// Sequences
db.prepare("INSERT INTO sequences (name, value) VALUES ('subscription', 2) ON CONFLICT(name) DO UPDATE SET value = 2").run();
db.prepare("INSERT INTO sequences (name, value) VALUES ('invoice', 1) ON CONFLICT(name) DO UPDATE SET value = 1").run();

db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA wal_checkpoint(TRUNCATE);');

console.log('✅ Sample data populated successfully!');

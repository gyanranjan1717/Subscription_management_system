const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

const dbPath = path.resolve(__dirname, '../data/brightloop.sqlite');
const dir = path.dirname(dbPath);
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

const db = new DatabaseSync(dbPath);

console.log('Seeding judges benchmark dataset into:', dbPath);

// Ensure schema is applied if database was freshly created
const schemaPath = path.resolve(__dirname, '../src/db/schema.sql');
const distSchemaPath = path.resolve(__dirname, '../dist/db/schema.sql');
if (fs.existsSync(schemaPath)) {
  db.exec(fs.readFileSync(schemaPath, 'utf8'));
} else if (fs.existsSync(distSchemaPath)) {
  db.exec(fs.readFileSync(distSchemaPath, 'utf8'));
}

db.exec('PRAGMA foreign_keys = OFF;');

// High security compliant passwords (> 8 chars, 1 upper, 1 lower, 1 special)
const ADMIN_PASS = 'Admin@Brightloop2026!';
const STAFF_PASS = 'Staff@Brightloop2026!';
const CUST_PASS = 'Customer@Brightloop2026!';

const adminHash = bcrypt.hashSync(ADMIN_PASS, 10);
const staffHash = bcrypt.hashSync(STAFF_PASS, 10);
const custHash = bcrypt.hashSync(CUST_PASS, 10);

// 1. Clean existing data
db.exec('DELETE FROM subscription_lines;');
db.exec('DELETE FROM subscriptions;');
db.exec('DELETE FROM invoice_lines;');
db.exec('DELETE FROM invoices;');
db.exec('DELETE FROM payments;');
db.exec('DELETE FROM product_variants;');
db.exec('DELETE FROM products;');
db.exec('DELETE FROM plans;');
db.exec('DELETE FROM tax_rules;');
db.exec('DELETE FROM discount_rules;');
db.exec('DELETE FROM quotation_template_lines;');
db.exec('DELETE FROM quotation_templates;');
db.exec('DELETE FROM users;');

// 2. Insert 2 Admins
const adminStmt = db.prepare('INSERT INTO users (email, password_hash, full_name, role, phone, company_name) VALUES (?, ?, ?, ?, ?, ?)');
const admin1 = Number(adminStmt.run('ranjangyan153@gmail.com', adminHash, 'Gyan Ranjan (Lead Admin)', 'admin', '+91 98765 00001', 'Brightloop HQ').lastInsertRowid);
const admin2 = Number(adminStmt.run('admin@brightloop.io', adminHash, 'Alex Mercer (Infrastructure Admin)', 'admin', '+91 98765 00002', 'Brightloop Security').lastInsertRowid);

// 3. Insert 5 Staff Members
const staffStmt = db.prepare('INSERT INTO users (email, password_hash, full_name, role, phone, company_name, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)');
const staff1 = Number(staffStmt.run('staff1@brightloop.io', staffHash, 'Sarah Jenkins (Billing Ops Lead)', 'staff', '+91 98765 10001', 'Brightloop Operations', admin1).lastInsertRowid);
const staff2 = Number(staffStmt.run('staff2@brightloop.io', staffHash, 'David Kumar (Sales & Quotations)', 'staff', '+91 98765 10002', 'Brightloop Commercial', admin1).lastInsertRowid);
const staff3 = Number(staffStmt.run('staff3@brightloop.io', staffHash, 'Priya Nair (Accounts Receivable)', 'staff', '+91 98765 10003', 'Brightloop Finance', admin1).lastInsertRowid);
const staff4 = Number(staffStmt.run('staff4@brightloop.io', staffHash, 'Michael Chen (Customer Success)', 'staff', '+91 98765 10004', 'Brightloop Support', admin1).lastInsertRowid);
const staff5 = Number(staffStmt.run('staff5@brightloop.io', staffHash, 'Elena Rostova (Compliance & Audit)', 'staff', '+91 98765 10005', 'Brightloop Compliance', admin1).lastInsertRowid);

// 4. Insert 10 Customers
const custStmt = db.prepare('INSERT INTO users (email, password_hash, full_name, role, phone, company_name) VALUES (?, ?, ?, ?, ?, ?)');
const customersData = [
  { email: 'rgyan931@gmail.com', name: 'Gyan Ranjan', company: 'Brightloop Technologies' },
  { email: 'customer1@acme.com', name: 'Robert Downey', company: 'Acme Industrial Corp' },
  { email: 'customer2@apex.com', name: 'Emma Watson', company: 'Apex Global Logistics' },
  { email: 'customer3@cloudbyte.com', name: 'Ananya Sharma', company: 'CloudByte Systems' },
  { email: 'customer4@fintech.io', name: 'Liam Neeson', company: 'FinTech Prime Capital' },
  { email: 'customer5@healthplus.com', name: 'Dr. Aris Thorne', company: 'HealthPlus Diagnostics' },
  { email: 'customer6@hyperion.com', name: 'Sophia Loren', company: 'Hyperion Aerospace' },
  { email: 'customer7@matrixlab.com', name: 'Marcus Vance', company: 'Matrix Automation Labs' },
  { email: 'customer8@quantum.io', name: 'Zoya Khan', company: 'Quantum AI Systems' },
  { email: 'customer9@summitcorp.com', name: 'Neil Armstrong', company: 'Summit Media Networks' }
];

const customerIds = [];
for (const c of customersData) {
  customerIds.push(Number(custStmt.run(c.email, custHash, c.name, 'customer', '+91 98765 20000', c.company).lastInsertRowid));
}

// 5. Tax Rules
const gst = Number(db.prepare("INSERT INTO tax_rules (name, rate_percentage, is_default, is_active) VALUES ('Standard GST (18%)', 18, 1, 1)").run().lastInsertRowid);
const reducedTax = Number(db.prepare("INSERT INTO tax_rules (name, rate_percentage, is_default, is_active) VALUES ('Reduced Tech Rate (5%)', 5, 0, 1)").run().lastInsertRowid);
db.prepare("INSERT INTO tax_rules (name, rate_percentage, is_default, is_active) VALUES ('Zero-Rated Export (0%)', 0, 0, 1)").run();

// 6. Products & Variants
const pStmt = db.prepare('INSERT INTO products (name, type, sales_price, cost_price, notes) VALUES (?, ?, ?, ?, ?)');
const p1 = Number(pStmt.run('Brightloop Core ERP Platform', 'software', 1200.00, 300.00, 'Flagship enterprise cloud subscription').lastInsertRowid);
const p2 = Number(pStmt.run('24/7 Priority Support SLA', 'service', 500.00, 100.00, 'Dedicated TAM & 1-hour SLA response').lastInsertRowid);
const p3 = Number(pStmt.run('Advanced BI Analytics Module', 'addon', 350.00, 50.00, 'Real-time telemetry and reporting module').lastInsertRowid);
const p4 = Number(pStmt.run('Additional User Seat Expansion', 'software', 50.00, 10.00, 'Per-seat expansion pack').lastInsertRowid);

const vStmt = db.prepare('INSERT INTO product_variants (product_id, attribute_name, option_name, price_extra) VALUES (?, ?, ?, ?)');
const stdVariant = Number(vStmt.run(p1, 'Edition', 'Standard Community', 0.00).lastInsertRowid);
const odooVariant = Number(vStmt.run(p1, 'Edition', 'Odoo Certified Edition', 560.00).lastInsertRowid);

// 7. Subscription Plans
const planStmt = db.prepare('INSERT INTO plans (name, billing_interval, price, min_quantity, auto_close, can_close_early, can_pause, can_renew, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)');
const monthlyPlan = Number(planStmt.run('Monthly Professional', 'monthly', 1200.00, 1, 0, 1, 1, 1).lastInsertRowid);
const yearlyPlan = Number(planStmt.run('Yearly Enterprise', 'yearly', 12000.00, 1, 0, 1, 1, 1).lastInsertRowid);
const weeklySprintPlan = Number(planStmt.run('Weekly Agile Sprint', 'weekly', 350.00, 1, 1, 0, 1, 1).lastInsertRowid);
const dailyPassPlan = Number(planStmt.run('High-Compute Daily Pass', 'daily', 99.00, 5, 1, 0, 0, 1).lastInsertRowid);

// 8. Discount Rules
const discStmt = db.prepare(`
  INSERT INTO discount_rules (code, description, discount_type, value, min_amount, min_quantity, start_date, end_date, max_uses, current_uses, applies_to, target_product_id, created_by, is_active)
  VALUES (?, ?, ?, ?, ?, ?, '2026-01-01', '2027-12-31', 100, 0, 'all', NULL, ?, 1)
`);
const disc20 = Number(discStmt.run('SAVE20', '20% off all orders', 'percentage', 20.00, 0, 0, admin1).lastInsertRowid);
const flat500 = Number(discStmt.run('FLAT500', '₹500 flat off orders above ₹2000', 'fixed', 500.00, 2000.00, 0, admin1).lastInsertRowid);

// 9. Quotation Templates
const qTemplate = Number(db.prepare("INSERT INTO quotation_templates (name, plan_id, validity_days, notes, is_active) VALUES ('Enterprise Growth Stack', ?, 30, 'ERP + 24/7 SLA + 5 Seats', 1)").run(monthlyPlan).lastInsertRowid);
db.prepare("INSERT INTO quotation_template_lines (template_id, product_id, variant_id, default_quantity) VALUES (?, ?, ?, 1), (?, ?, NULL, 1), (?, ?, NULL, 5)").run(qTemplate, p1, odooVariant, qTemplate, p2, qTemplate, p4);

// 10. Subscriptions & Invoices for Customers

// Customer 0: Gyan Ranjan (rgyan931@gmail.com) -> Active Subscription + Ready to Pay Invoice
const sub1 = Number(db.prepare(`
  INSERT INTO subscriptions (subscription_number, customer_id, plan_id, status, start_date, expiry_date, next_period_index, next_billing_date, payment_terms, notes)
  VALUES ('SUB-2026-000001', ?, ?, 'Active', '2026-09-01', '2027-09-01', 1, '2026-10-01', 'Immediate Payment', 'Key Strategic Enterprise Contract')
`).run(customerIds[0], monthlyPlan).lastInsertRowid);
db.prepare("INSERT INTO subscription_lines (subscription_id, product_id, variant_id, quantity, unit_price, tax_id, line_amount) VALUES (?, ?, ?, 1, 1760.00, ?, 1760.00)").run(sub1, p1, odooVariant, gst);
db.prepare("INSERT INTO subscription_lines (subscription_id, product_id, variant_id, quantity, unit_price, tax_id, line_amount) VALUES (?, ?, NULL, 1, 500.00, ?, 500.00)").run(sub1, p2, gst);

// Customer 0 Quotation (Draft to confirm)
const subQuotation = Number(db.prepare(`
  INSERT INTO subscriptions (subscription_number, customer_id, plan_id, status, start_date, expiry_date, next_period_index, next_billing_date, payment_terms, quotation_sent_on, quotation_valid_until, notes)
  VALUES ('SUB-2026-000002', ?, ?, 'Quotation', '2026-10-31', '2027-10-31', 0, '2026-10-31', '30 Days Net', '2026-10-31', '2026-11-30', 'Yearly expansion proposal waiting for confirmation')
`).run(customerIds[0], yearlyPlan).lastInsertRowid);
db.prepare("INSERT INTO subscription_lines (subscription_id, product_id, variant_id, quantity, unit_price, tax_id, line_amount) VALUES (?, ?, ?, 1, 1200.00, ?, 1200.00)").run(subQuotation, p1, stdVariant, gst);

// Customer 0 Confirmed Invoice (INV-2026-000001) -> Total ₹2,666.80
const inv1 = Number(db.prepare(`
  INSERT INTO invoices (invoice_number, subscription_id, customer_id, period_index, period_start, period_end, subtotal, tax_amount, discount_amount, total_amount, amount_paid, status, issue_date, due_date)
  VALUES ('INV-2026-000001', ?, ?, 0, '2026-09-01', '2026-09-30', 2260.00, 406.80, 0.00, 2666.80, 0.00, 'Confirmed', '2026-09-01', '2026-10-15')
`).run(sub1, customerIds[0]).lastInsertRowid);
db.prepare("INSERT INTO invoice_lines (invoice_id, kind, product_id, variant_id, description, quantity, unit_price, gross_amount, discount_amount, net_amount, tax_name, tax_rate, tax_amount, line_total) VALUES (?, 'PRODUCT', ?, ?, 'Brightloop Core ERP Platform (Edition: Odoo Certified Edition)', 1, 1760.00, 1760.00, 0.00, 1760.00, 'Standard GST (18%)', 18, 316.80, 2076.80)").run(inv1, p1, odooVariant);
db.prepare("INSERT INTO invoice_lines (invoice_id, kind, product_id, variant_id, description, quantity, unit_price, gross_amount, discount_amount, net_amount, tax_name, tax_rate, tax_amount, line_total) VALUES (?, 'PRODUCT', ?, NULL, '24/7 Priority Support SLA', 1, 500.00, 500.00, 0.00, 500.00, 'Standard GST (18%)', 18, 90.00, 590.00)").run(inv1, p2);

// Customer 1: Acme (Paid Invoice with Payment record)
const subAcme = Number(db.prepare(`
  INSERT INTO subscriptions (subscription_number, customer_id, plan_id, status, start_date, expiry_date, next_period_index, next_billing_date, payment_terms, notes)
  VALUES ('SUB-2026-000003', ?, ?, 'Active', '2026-08-01', '2027-08-01', 2, '2026-10-01', 'Immediate Payment', 'Acme Corporate Contract')
`).run(customerIds[1], monthlyPlan).lastInsertRowid);
db.prepare("INSERT INTO subscription_lines (subscription_id, product_id, variant_id, quantity, unit_price, tax_id, line_amount) VALUES (?, ?, ?, 1, 1200.00, ?, 1200.00)").run(subAcme, p1, stdVariant, gst);

const invAcme = Number(db.prepare(`
  INSERT INTO invoices (invoice_number, subscription_id, customer_id, period_index, period_start, period_end, subtotal, tax_amount, discount_amount, total_amount, amount_paid, status, issue_date, due_date)
  VALUES ('INV-2026-000002', ?, ?, 0, '2026-08-01', '2026-08-31', 1200.00, 216.00, 0.00, 1416.00, 1416.00, 'Paid', '2026-08-01', '2026-08-15')
`).run(subAcme, customerIds[1]).lastInsertRowid);
db.prepare("INSERT INTO invoice_lines (invoice_id, kind, product_id, variant_id, description, quantity, unit_price, gross_amount, discount_amount, net_amount, tax_name, tax_rate, tax_amount, line_total) VALUES (?, 'PRODUCT', ?, ?, 'Brightloop Core ERP Platform (Standard Edition)', 1, 1200.00, 1200.00, 0.00, 1200.00, 'Standard GST (18%)', 18, 216.00, 1416.00)").run(invAcme, p1, stdVariant);
db.prepare("INSERT INTO payments (invoice_id, amount, payment_method, payment_date, reference, note, recorded_by) VALUES (?, 1416.00, 'Bank Transfer', '2026-08-05', 'HDFC-NEFT-991823', 'Settled in full via NEFT', ?)").run(invAcme, admin1);

// Customer 2: Apex Global (Overdue invoice for testing Chase / Reminders)
const subApex = Number(db.prepare(`
  INSERT INTO subscriptions (subscription_number, customer_id, plan_id, status, start_date, expiry_date, next_period_index, next_billing_date, payment_terms, notes)
  VALUES ('SUB-2026-000004', ?, ?, 'Active', '2026-07-01', '2027-07-01', 3, '2026-10-01', 'Immediate Payment', 'Apex Global Logistics Contract')
`).run(customerIds[2], monthlyPlan).lastInsertRowid);
db.prepare("INSERT INTO subscription_lines (subscription_id, product_id, variant_id, quantity, unit_price, tax_id, line_amount) VALUES (?, ?, NULL, 2, 350.00, ?, 700.00)").run(subApex, p3, gst);

const invApex = Number(db.prepare(`
  INSERT INTO invoices (invoice_number, subscription_id, customer_id, period_index, period_start, period_end, subtotal, tax_amount, discount_amount, total_amount, amount_paid, status, issue_date, due_date)
  VALUES ('INV-2026-000003', ?, ?, 0, '2026-07-01', '2026-07-31', 700.00, 126.00, 0.00, 826.00, 0.00, 'Confirmed', '2026-07-01', '2026-07-15')
`).run(subApex, customerIds[2]).lastInsertRowid);
db.prepare("INSERT INTO invoice_lines (invoice_id, kind, product_id, variant_id, description, quantity, unit_price, gross_amount, discount_amount, net_amount, tax_name, tax_rate, tax_amount, line_total) VALUES (?, 'PRODUCT', ?, NULL, 'Advanced BI Analytics Module [2 Licenses]', 2, 350.00, 700.00, 0.00, 700.00, 'Standard GST (18%)', 18, 126.00, 826.00)").run(invApex, p3);

// Customer 3: CloudByte (Paused subscription)
const subCloud = Number(db.prepare(`
  INSERT INTO subscriptions (subscription_number, customer_id, plan_id, status, start_date, expiry_date, next_period_index, next_billing_date, payment_terms, notes)
  VALUES ('SUB-2026-000005', ?, ?, 'Paused', '2026-06-01', '2027-06-01', 1, '2026-07-01', '30 Days Net', 'Paused during internal reorganization')
`).run(customerIds[3], monthlyPlan).lastInsertRowid);
db.prepare("INSERT INTO subscription_lines (subscription_id, product_id, variant_id, quantity, unit_price, tax_id, line_amount) VALUES (?, ?, ?, 1, 1200.00, ?, 1200.00)").run(subCloud, p1, stdVariant, gst);

// Customer 4: FinTech Prime (Weekly Sprint subscription)
const subFinTech = Number(db.prepare(`
  INSERT INTO subscriptions (subscription_number, customer_id, plan_id, status, start_date, expiry_date, next_period_index, next_billing_date, payment_terms, notes)
  VALUES ('SUB-2026-000006', ?, ?, 'Active', '2026-10-15', '2027-04-15', 2, '2026-11-01', '15 Days Net', 'Weekly high-frequency testing')
`).run(customerIds[4], weeklySprintPlan).lastInsertRowid);
db.prepare("INSERT INTO subscription_lines (subscription_id, product_id, variant_id, quantity, unit_price, tax_id, line_amount) VALUES (?, ?, NULL, 4, 350.00, ?, 1400.00)").run(subFinTech, p3, gst);

// Sequences
db.prepare("INSERT INTO sequences (name, value) VALUES ('subscription', 6) ON CONFLICT(name) DO UPDATE SET value = 6").run();
db.prepare("INSERT INTO sequences (name, value) VALUES ('invoice', 3) ON CONFLICT(name) DO UPDATE SET value = 3").run();
db.prepare("INSERT INTO sequences (name, value) VALUES ('payment', 1) ON CONFLICT(name) DO UPDATE SET value = 1").run();

db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA wal_checkpoint(TRUNCATE);');

console.log('================================================================');
console.log('✅ BENCHMARK DATASET READY:');
console.log('   - 2 Admins (Password: ' + ADMIN_PASS + ')');
console.log('   - 5 Staff Members (Password: ' + STAFF_PASS + ')');
console.log('   - 10 Customers (Password: ' + CUST_PASS + ')');
console.log('   - 6 Subscriptions across lifecycle (Active, Quotation, Paused)');
console.log('   - 3 Invoices (Confirmed with balance due, Overdue for chasing, Paid)');
console.log('   - 1 Payment with NEFT reference');
console.log('================================================================');

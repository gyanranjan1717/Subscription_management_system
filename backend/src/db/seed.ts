import bcrypt from 'bcryptjs';
import { getDb, execute, queryOne, runTransaction } from './database.js';

async function seed() {
  console.log('--- Starting Brightloop Database Seeding ---');
  const db = getDb();

  // Clear existing tables for fresh deterministic run
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
  // Passwords strictly adhere to >8 characters (9+), upper, lower, special:
  const adminPass = await bcrypt.hash('Brightloop#2026', salt);
  const staffPass = await bcrypt.hash('Brightloop#2026', salt);
  const custPass = await bcrypt.hash('Customer#2026', salt);

  // 1. Seed Users
  console.log('Seeding Users (Admin, Staff, Customers)...');
  const adminRes = execute(`
    INSERT INTO users (email, password_hash, full_name, role, phone, company_name)
    VALUES (?, ?, ?, 'admin', ?, ?)
  `, ['admin@brightloop.com', adminPass, 'Alex Mercer (Admin)', '+1-555-0100', 'Brightloop HQ']);
  const adminId = Number(adminRes.lastInsertRowid);

  const staffRes = execute(`
    INSERT INTO users (email, password_hash, full_name, role, phone, company_name)
    VALUES (?, ?, ?, 'staff', ?, ?)
  `, ['staff@brightloop.com', staffPass, 'Sarah Jenkins (Billing Ops)', '+1-555-0101', 'Brightloop Operations']);
  const staffId = Number(staffRes.lastInsertRowid);

  const cust1Res = execute(`
    INSERT INTO users (email, password_hash, full_name, role, phone, company_name)
    VALUES (?, ?, ?, 'customer', ?, ?)
  `, ['acme@corp.com', custPass, 'David Miller', '+1-555-0201', 'Acme Corporation']);
  const cust1Id = Number(cust1Res.lastInsertRowid);

  const cust2Res = execute(`
    INSERT INTO users (email, password_hash, full_name, role, phone, company_name)
    VALUES (?, ?, ?, 'customer', ?, ?)
  `, ['globex@biz.com', custPass, 'Elena Rostova', '+1-555-0202', 'Globex International']);
  const cust2Id = Number(cust2Res.lastInsertRowid);

  // 2. Seed Tax Rules
  console.log('Seeding Tax Rules...');
  const gstRes = execute(`
    INSERT INTO tax_rules (name, rate_percentage, is_default, is_active)
    VALUES ('Standard VAT / GST (18%)', 18.0, 1, 1)
  `);
  const defaultTaxId = Number(gstRes.lastInsertRowid);

  execute(`
    INSERT INTO tax_rules (name, rate_percentage, is_default, is_active)
    VALUES ('Reduced Software Rate (5%)', 5.0, 0, 1),
           ('Zero-Rated Export (0%)', 0.0, 0, 1)
  `);

  // 3. Seed Products & Variants
  console.log('Seeding Products & Variants (including Odoo brand +560)...');
  const prod1Res = execute(`
    INSERT INTO products (name, type, sales_price, cost_price, notes)
    VALUES ('Brightloop Core ERP Platform', 'software', 1200.00, 300.00, 'Flagship enterprise subscription software')
  `);
  const prod1Id = Number(prod1Res.lastInsertRowid);

  // Requirement: Odoo brand adds 560 to price
  const varStd = execute(`
    INSERT INTO product_variants (product_id, attribute_name, option_name, price_extra)
    VALUES (?, 'Brand', 'Standard Community', 0.00)
  `, [prod1Id]);
  const varStdId = Number(varStd.lastInsertRowid);

  const varOdoo = execute(`
    INSERT INTO product_variants (product_id, attribute_name, option_name, price_extra)
    VALUES (?, 'Brand', 'Odoo Certified Edition', 560.00)
  `, [prod1Id]);
  const varOdooId = Number(varOdoo.lastInsertRowid);

  const prod2Res = execute(`
    INSERT INTO products (name, type, sales_price, cost_price, notes)
    VALUES ('Advanced BI Analytics Add-On', 'addon', 350.00, 50.00, 'Real-time telemetry and reporting module')
  `);
  const prod2Id = Number(prod2Res.lastInsertRowid);

  const prod3Res = execute(`
    INSERT INTO products (name, type, sales_price, cost_price, notes)
    VALUES ('24/7 Priority SLA & Dedicated TAM', 'service', 500.00, 120.00, 'Direct line to technical account manager')
  `);
  const prod3Id = Number(prod3Res.lastInsertRowid);

  const prod4Res = execute(`
    INSERT INTO products (name, type, sales_price, cost_price, notes)
    VALUES ('Additional User Seat License', 'software', 45.00, 5.00, 'Per-seat user expansion pack')
  `);
  const prod4Id = Number(prod4Res.lastInsertRowid);

  // 4. Seed Plans
  console.log('Seeding Plans (daily, weekly, monthly, yearly)...');
  const planYearly = execute(`
    INSERT INTO plans (name, billing_interval, price, min_quantity, auto_close, can_pause, can_renew)
    VALUES ('Enterprise Yearly Contract', 'yearly', 12000.00, 1, 0, 1, 1)
  `);
  const planYearlyId = Number(planYearly.lastInsertRowid);

  const planMonthly = execute(`
    INSERT INTO plans (name, billing_interval, price, min_quantity, auto_close, can_pause, can_renew)
    VALUES ('Standard Business Monthly', 'monthly', 1200.00, 1, 0, 1, 1)
  `);
  const planMonthlyId = Number(planMonthly.lastInsertRowid);

  const planWeekly = execute(`
    INSERT INTO plans (name, billing_interval, price, min_quantity, auto_close, can_pause, can_renew)
    VALUES ('Pilot Sprint Weekly', 'weekly', 350.00, 1, 1, 0, 1)
  `);
  const planWeeklyId = Number(planWeekly.lastInsertRowid);

  const planDaily = execute(`
    INSERT INTO plans (name, billing_interval, price, min_quantity, auto_close, can_pause, can_renew)
    VALUES ('High-Compute Daily Pass', 'daily', 50.00, 5, 1, 0, 0)
  `);
  const planDailyId = Number(planDaily.lastInsertRowid);

  // 5. Seed Quotation Templates
  console.log('Seeding Quotation Templates...');
  const tpl1 = execute(`
    INSERT INTO quotation_templates (name, plan_id, validity_days, notes)
    VALUES ('SMB Growth Starter Template', ?, 30, 'Standard package for emerging companies')
  `, [planMonthlyId]);
  const tpl1Id = Number(tpl1.lastInsertRowid);

  execute(`
    INSERT INTO quotation_template_lines (template_id, product_id, variant_id, default_quantity)
    VALUES (?, ?, ?, 1),
           (?, ?, NULL, 5)
  `, [tpl1Id, prod1Id, varStdId, tpl1Id, prod4Id]);

  const tpl2 = execute(`
    INSERT INTO quotation_templates (name, plan_id, validity_days, notes)
    VALUES ('Odoo Enterprise Strategic Stack', ?, 60, 'Premium configuration with Odoo brand variant and 24/7 SLA')
  `, [planYearlyId]);
  const tpl2Id = Number(tpl2.lastInsertRowid);

  execute(`
    INSERT INTO quotation_template_lines (template_id, product_id, variant_id, default_quantity)
    VALUES (?, ?, ?, 1),
           (?, ?, NULL, 1),
           (?, ?, NULL, 10)
  `, [tpl2Id, prod1Id, varOdooId, tpl2Id, prod3Id, tpl2Id, prod4Id]);

  // 6. Seed Discount Rules
  console.log('Seeding Discount Rules...');
  const discVolume = execute(`
    INSERT INTO discount_rules (
      code, description, discount_type, value, min_amount, min_quantity,
      start_date, end_date, max_uses, current_uses, applies_to
    ) VALUES ('SEATS20', '20% off for 5 or more seats', 'percentage', 20.0, 0, 5, '2026-01-01', '2027-12-31', 100, 2, 'all')
  `);
  const discVolumeId = Number(discVolume.lastInsertRowid);

  const discFixed = execute(`
    INSERT INTO discount_rules (
      code, description, discount_type, value, min_amount, min_quantity,
      start_date, end_date, max_uses, current_uses, applies_to
    ) VALUES ('ENTERPRISE500', '$500 flat off orders above $2000', 'fixed', 500.0, 2000.0, 0, '2026-01-01', '2027-12-31', 50, 0, 'all')
  `);
  const discFixedId = Number(discFixed.lastInsertRowid);

  execute(`
    INSERT INTO discount_rules (
      code, description, discount_type, value, min_amount, min_quantity,
      start_date, end_date, max_uses, current_uses, applies_to, target_product_id
    ) VALUES ('ODOOPROMO15', '15% special discount on Odoo ERP Core', 'percentage', 15.0, 0, 0, '2026-01-01', '2027-12-31', 30, 0, 'product', ?)
  `, [prod1Id]);

  // Expired discount rule (to test validation)
  execute(`
    INSERT INTO discount_rules (
      code, description, discount_type, value, min_amount, min_quantity,
      start_date, end_date, max_uses, current_uses, applies_to
    ) VALUES ('EXPIRED10', 'Expired summer discount', 'percentage', 10.0, 0, 0, '2025-01-01', '2025-06-30', 10, 10, 'all')
  `);

  // 7. Seed Active Subscriptions Ready for Billing Engine Demo
  console.log('Seeding Subscriptions in various lifecycle states...');
  const todayStr = new Date().toISOString().split('T')[0];

  // Active Subscription 1 (Due today for Acme Corp)
  const sub1 = execute(`
    INSERT INTO subscriptions (
      subscription_number, customer_id, plan_id, status,
      start_date, expiry_date, next_billing_date, payment_terms, discount_rule_id, notes
    ) VALUES ('SUB-2026-00001', ?, ?, 'Active', '2026-09-01', '2027-09-01', ?, '30 Days Net', ?, 'Key Account Contract')
  `, [cust1Id, planMonthlyId, todayStr, discVolumeId]);
  const sub1Id = Number(sub1.lastInsertRowid);

  execute(`
    INSERT INTO subscription_lines (subscription_id, product_id, variant_id, quantity, unit_price, tax_id, line_amount)
    VALUES (?, ?, ?, 1, 1760.00, ?, 1760.00),
           (?, ?, NULL, 1, 350.00, ?, 350.00),
           (?, ?, NULL, 6, 45.00, ?, 270.00)
  `, [sub1Id, prod1Id, varOdooId, defaultTaxId, sub1Id, prod2Id, defaultTaxId, sub1Id, prod4Id, defaultTaxId]);

  // Active Subscription 2 (For Globex Inc)
  const sub2 = execute(`
    INSERT INTO subscriptions (
      subscription_number, customer_id, plan_id, status,
      start_date, expiry_date, next_billing_date, payment_terms, discount_rule_id, notes
    ) VALUES ('SUB-2026-00002', ?, ?, 'Active', '2026-10-01', '2027-10-01', ?, 'Immediate Payment', ?, 'Globex Business Tier')
  `, [cust2Id, planMonthlyId, todayStr, discFixedId]);
  const sub2Id = Number(sub2.lastInsertRowid);

  execute(`
    INSERT INTO subscription_lines (subscription_id, product_id, variant_id, quantity, unit_price, tax_id, line_amount)
    VALUES (?, ?, ?, 1, 1200.00, ?, 1200.00),
           (?, ?, NULL, 10, 45.00, ?, 450.00)
  `, [sub2Id, prod1Id, varStdId, defaultTaxId, sub2Id, prod4Id, defaultTaxId]);

  // Subscription in Quotation state
  const subQuote = execute(`
    INSERT INTO subscriptions (
      subscription_number, customer_id, plan_id, status,
      start_date, expiry_date, next_billing_date, payment_terms, notes
    ) VALUES ('SUB-2026-00003', ?, ?, 'Quotation', ?, '2027-10-31', ?, '15 Days Net', 'Pending customer executive sign-off')
  `, [cust1Id, planYearlyId, todayStr, todayStr]);
  const subQuoteId = Number(subQuote.lastInsertRowid);

  execute(`
    INSERT INTO subscription_lines (subscription_id, product_id, variant_id, quantity, unit_price, tax_id, line_amount)
    VALUES (?, ?, ?, 1, 1760.00, ?, 1760.00),
           (?, ?, NULL, 1, 500.00, ?, 500.00)
  `, [subQuoteId, prod1Id, varOdooId, defaultTaxId, subQuoteId, prod3Id, defaultTaxId]);

  // Subscription in Draft state
  execute(`
    INSERT INTO subscriptions (
      subscription_number, customer_id, plan_id, status,
      start_date, expiry_date, next_billing_date, payment_terms, notes
    ) VALUES ('SUB-2026-00004', ?, ?, 'Draft', ?, '2027-10-31', ?, 'Immediate Payment', 'Sales draft being configured')
  `, [cust2Id, planMonthlyId, todayStr, todayStr]);

  // Subscription in Paused state
  execute(`
    INSERT INTO subscriptions (
      subscription_number, customer_id, plan_id, status,
      start_date, expiry_date, next_billing_date, payment_terms, notes
    ) VALUES ('SUB-2026-00005', ?, ?, 'Paused', '2026-06-01', '2027-06-01', ?, 'Immediate Payment', 'Temporarily paused per client request')
  `, [cust1Id, planMonthlyId, todayStr]);

  // Subscription in Closed state
  execute(`
    INSERT INTO subscriptions (
      subscription_number, customer_id, plan_id, status,
      start_date, expiry_date, next_billing_date, payment_terms, notes
    ) VALUES ('SUB-2026-00006', ?, ?, 'Closed', '2025-01-01', '2025-12-31', '2025-12-31', 'Immediate Payment', 'Expired yearly contract')
  `, [cust2Id, planYearlyId]);

  // 8. Seed Sample Invoices (Paid, Confirmed, Overdue)
  console.log('Seeding Sample Invoices & Overdue Accounts for chasing...');
  // Prior Paid Invoice
  const inv1 = execute(`
    INSERT INTO invoices (
      invoice_number, subscription_id, customer_id, period_start, period_end,
      subtotal, tax_amount, discount_amount, total_amount, amount_paid,
      status, issue_date, due_date
    ) VALUES ('INV-2026-00001', ?, ?, '2026-08-01', '2026-09-01', 2380.00, 342.72, 476.00, 2246.72, 2246.72, 'Paid', '2026-08-01', '2026-08-31')
  `, [sub1Id, cust1Id]);
  const inv1Id = Number(inv1.lastInsertRowid);

  execute(`
    INSERT INTO payments (invoice_id, amount, payment_method, payment_date, reference, note)
    VALUES (?, 2246.72, 'Bank Transfer', '2026-08-15', 'WIRE-TX-98421', 'Full payment settled')
  `, [inv1Id]);

  // Overdue Invoice for Chasing
  const invOverdue = execute(`
    INSERT INTO invoices (
      invoice_number, subscription_id, customer_id, period_start, period_end,
      subtotal, tax_amount, discount_amount, total_amount, amount_paid,
      status, issue_date, due_date
    ) VALUES ('INV-2026-00002', ?, ?, '2026-09-01', '2026-10-01', 1650.00, 207.00, 500.00, 1357.00, 357.00, 'Confirmed', '2026-09-01', '2026-09-30')
  `, [sub2Id, cust2Id]);
  const invOverdueId = Number(invOverdue.lastInsertRowid);

  execute(`
    INSERT INTO payments (invoice_id, amount, payment_method, payment_date, reference, note)
    VALUES (?, 357.00, 'Credit Card', '2026-09-10', 'AUTH-VISA-4421', 'Partial deposit received')
  `, [invOverdueId]);

  // 9. Scaled Synthetic Subscriptions (1,000 subscriptions) for <2s stress benchmark
  console.log('Seeding 1,000 scaled subscriptions to prove Sub-2-Second Performance SLA...');
  const stmtSub = db.prepare(`
    INSERT INTO subscriptions (
      subscription_number, customer_id, plan_id, status,
      start_date, expiry_date, next_billing_date, payment_terms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const stmtLine = db.prepare(`
    INSERT INTO subscription_lines (
      subscription_id, product_id, variant_id, quantity, unit_price, tax_id, line_amount
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const statuses = ['Active', 'Active', 'Active', 'Active', 'Confirmed', 'Draft', 'Paused', 'Closed'];
  const plansList = [planMonthlyId, planYearlyId, planWeeklyId, planDailyId];
  const customersList = [cust1Id, cust2Id];

  runTransaction(() => {
    for (let i = 10; i <= 1010; i++) {
      const sNum = `SUB-BENCH-${String(i).padStart(6, '0')}`;
      const status = statuses[i % statuses.length];
      const pId = plansList[i % plansList.length];
      const cId = customersList[i % customersList.length];
      const nextDate = `2026-11-${String((i % 28) + 1).padStart(2, '0')}`;

      const res = stmtSub.run(sNum, cId, pId, status, '2026-01-01', '2027-01-01', nextDate, '30 Days Net');
      const newSubId = Number(res.lastInsertRowid);

      stmtLine.run(newSubId, prod1Id, varStdId, 1, 1200.00, defaultTaxId, 1200.00);
      if (i % 3 === 0) {
        stmtLine.run(newSubId, prod4Id, null, 5, 45.00, defaultTaxId, 225.00);
      }
    }
  });

  const totalSubs = queryOne<{ count: number }>('SELECT COUNT(*) as count FROM subscriptions');
  const totalInvs = queryOne<{ count: number }>('SELECT COUNT(*) as count FROM invoices');
  console.log(`Database seeded successfully!`);
  console.log(`Total Subscriptions in DB: ${totalSubs?.count}`);
  console.log(`Total Invoices in DB: ${totalInvs?.count}`);
}

seed().catch(err => {
  console.error('Seed Failed:', err);
  process.exit(1);
});

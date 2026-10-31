import './env.js';
import bcrypt from 'bcryptjs';
import type { AddressInfo } from 'net';
import { getDb, execute, queryOne, queryAll } from '../src/db/database.js';
import app from '../src/server.js';

export { getDb, execute, queryOne, queryAll };

export const PASSWORD = 'Brightloop#2026';

let baseUrl = '';
const server = app.listen(0);
baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
export const closeServer = () => server.close();

export async function api(method: string, path: string, token?: string | null, body?: unknown) {
  const res = await fetch(`${baseUrl}/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* csv or empty */ }
  return { status: res.status, body: json, text };
}

const hash = bcrypt.hashSync(PASSWORD, 4);

export function insertUser(email: string, role: 'admin' | 'staff' | 'customer', name = email): number {
  return Number(execute(
    'INSERT INTO users (email, password_hash, full_name, role) VALUES (?, ?, ?, ?)',
    [email, hash, name, role]
  ).lastInsertRowid);
}

export interface Fixture {
  adminId: number; staffId: number; custA: number; custB: number;
  admin: string; staff: string; a: string; b: string;
  taxId: number; productId: number; stdVariant: number; odooVariant: number; monthlyPlan: number;
}

async function login(email: string): Promise<string> {
  const r = await api('POST', '/auth/login', null, { email, password: PASSWORD });
  if (r.status !== 200) throw new Error(`login failed for ${email}: ${r.status}`);
  return r.body.token;
}

/** One admin, one staff, two customers, an 18% default tax, a 1000 product with Odoo (+560) variant, a monthly plan. */
export async function baseFixture(): Promise<Fixture> {
  const adminId = insertUser('admin@test.com', 'admin');
  const staffId = insertUser('staff@test.com', 'staff');
  const custA = insertUser('a@test.com', 'customer');
  const custB = insertUser('b@test.com', 'customer');
  const taxId = Number(execute("INSERT INTO tax_rules (name, rate_percentage, is_default) VALUES ('GST 18%', 18, 1)").lastInsertRowid);
  const productId = Number(execute("INSERT INTO products (name, type, sales_price, cost_price) VALUES ('Cloud ERP', 'software', 1000, 300)").lastInsertRowid);
  const stdVariant = Number(execute("INSERT INTO product_variants (product_id, attribute_name, option_name, price_extra) VALUES (?, 'Brand', 'Standard', 0)", [productId]).lastInsertRowid);
  const odooVariant = Number(execute("INSERT INTO product_variants (product_id, attribute_name, option_name, price_extra) VALUES (?, 'Brand', 'Odoo', 560)", [productId]).lastInsertRowid);
  const monthlyPlan = newPlan('monthly');
  return {
    adminId, staffId, custA, custB,
    admin: await login('admin@test.com'), staff: await login('staff@test.com'),
    a: await login('a@test.com'), b: await login('b@test.com'),
    taxId, productId, stdVariant, odooVariant, monthlyPlan
  };
}

export function newPlan(interval: 'daily' | 'weekly' | 'monthly' | 'yearly', opts: Partial<Record<'min_quantity' | 'auto_close' | 'can_pause' | 'can_renew' | 'can_close_early', number>> = {}): number {
  return Number(execute(
    `INSERT INTO plans (name, billing_interval, price, min_quantity, auto_close, can_pause, can_renew, can_close_early)
     VALUES (?, ?, 0, ?, ?, ?, ?, ?)`,
    [`${interval} plan ${Math.random()}`, interval, opts.min_quantity ?? 1, opts.auto_close ?? 0, opts.can_pause ?? 1, opts.can_renew ?? 1, opts.can_close_early ?? 1]
  ).lastInsertRowid);
}

export function newProduct(price: number, name = `P${Math.random()}`): number {
  return Number(execute("INSERT INTO products (name, type, sales_price, cost_price) VALUES (?, 'software', ?, 1)", [name, price]).lastInsertRowid);
}

export interface SubOpts {
  customer: number; plan: number; start: string; status?: string; expiry?: string | null; terms?: string;
  discountId?: number | null; taxId?: number | null;
  lines: Array<{ product: number; qty?: number; unit: number; tax?: number | null }>;
}

/** Inserts a subscription straight into the database (Active by default) with the billing cursor at period 0. */
export function newSubscription(o: SubOpts): number {
  const n = Number(queryOne<{ c: number }>('SELECT COUNT(*) AS c FROM subscriptions')!.c) + 1;
  const id = Number(execute(
    `INSERT INTO subscriptions (subscription_number, customer_id, plan_id, status, start_date, expiry_date,
                                next_period_index, next_billing_date, payment_terms, discount_rule_id)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
    [`SUB-T-${String(n).padStart(5, '0')}`, o.customer, o.plan, o.status ?? 'Active', o.start, o.expiry ?? null, o.start, o.terms ?? 'Immediate Payment', o.discountId ?? null]
  ).lastInsertRowid);
  for (const l of o.lines) {
    const qty = l.qty ?? 1;
    execute(
      'INSERT INTO subscription_lines (subscription_id, product_id, quantity, unit_price, tax_id, line_amount) VALUES (?, ?, ?, ?, ?, ?)',
      [id, l.product, qty, l.unit, l.tax === undefined ? o.taxId ?? null : l.tax, Math.round(l.unit * qty * 100) / 100]
    );
  }
  return id;
}

export function newDiscount(o: {
  code: string; type: 'fixed' | 'percentage'; value: number; minAmount?: number; minQty?: number;
  start?: string | null; end?: string | null; maxUses?: number; scope?: 'all' | 'product' | 'subscription'; target?: number | null; uses?: number;
}): number {
  return Number(execute(
    `INSERT INTO discount_rules (code, description, discount_type, value, min_amount, min_quantity, start_date, end_date,
                                 max_uses, current_uses, applies_to, target_product_id)
     VALUES (?, 'test', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [o.code, o.type, o.value, o.minAmount ?? 0, o.minQty ?? 0, o.start ?? null, o.end ?? null, o.maxUses ?? 0, o.uses ?? 0, o.scope ?? 'all', o.target ?? null]
  ).lastInsertRowid);
}

export function invoicesOf(subId: number) {
  return queryAll<any>('SELECT * FROM invoices WHERE subscription_id = ? ORDER BY period_index', [subId]);
}

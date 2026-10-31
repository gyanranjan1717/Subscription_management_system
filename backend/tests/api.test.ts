import {
  api, baseFixture, closeServer, execute, newPlan, newProduct, newSubscription, queryAll, queryOne, Fixture, PASSWORD
} from './helpers.js';
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { runBillingCycle } from '../src/services/billingEngine.js';
import { buildIntegrityReport } from '../src/services/integrityService.js';

let f: Fixture;
let subA: number, subB: number, invA: number, invB: number;

before(async () => {
  f = await baseFixture();
  subA = newSubscription({ customer: f.custA, plan: f.monthlyPlan, start: '2026-01-01', taxId: f.taxId, lines: [{ product: f.productId, unit: 1000 }] });
  subB = newSubscription({ customer: f.custB, plan: f.monthlyPlan, start: '2026-01-01', taxId: f.taxId, lines: [{ product: f.productId, unit: 2000 }] });
  runBillingCycle('2026-01-01', { autoConfirm: true });
  invA = queryOne<any>('SELECT id FROM invoices WHERE subscription_id = ?', [subA]).id;
  invB = queryOne<any>('SELECT id FROM invoices WHERE subscription_id = ?', [subB]).id;
});
after(closeServer);

/** Sign-up always goes through email verification: request a code, then register with it. */
async function signUp(body: Record<string, unknown>) {
  const sent = await api('POST', '/auth/send-otp', null, { email: body.email });
  return api('POST', '/auth/register', null, { ...body, otp: sent.body?.otpPreview });
}

// ---- auth ----------------------------------------------------------------------------------------

test('auth: sign-up creates a customer, logs in, and rejects a duplicate email in any letter case with 409', async () => {
  const reg = await signUp({ email: 'New.User@Example.com', password: 'Abcdefgh!', full_name: 'New User' });
  assert.equal(reg.status, 201);
  assert.equal(reg.body.user.role, 'customer');
  assert.equal(reg.body.user.email, 'new.user@example.com');

  const dup = await api('POST', '/auth/send-otp', null, { email: 'NEW.USER@example.COM' });
  assert.equal(dup.status, 409, 'an address that already has an account cannot even request a sign-up code');

  // The database index, not just the route, enforces it.
  assert.throws(() => execute("INSERT INTO users (email, password_hash, full_name, role) VALUES ('NEW.user@example.com', 'x', 'x', 'customer')"), /UNIQUE/);

  const ok = await api('POST', '/auth/login', null, { email: 'new.user@EXAMPLE.com', password: 'Abcdefgh!' });
  assert.equal(ok.status, 200);
  const bad = await api('POST', '/auth/login', null, { email: 'new.user@example.com', password: 'wrong-Password1' });
  assert.equal(bad.status, 401);
  const unknown = await api('POST', '/auth/login', null, { email: 'nobody@example.com', password: 'wrong-Password1' });
  assert.equal(unknown.status, 401);
  assert.equal(unknown.body.error, bad.body.error, 'no user enumeration');
});

test('auth: sign-up enforces the password policy and cannot request a role', async () => {
  for (const password of ['Abcdefg!', 'abcdefgh!', 'ABCDEFGH!', 'Abcdefghi']) {
    const r = await signUp({ email: `p${password.length}${password[0]}@x.com`, password, full_name: 'X' });
    assert.equal(r.status, 400, `rejects ${password}`);
  }
  const sneaky = await signUp({ email: 'sneaky@x.com', password: 'Abcdefgh!', full_name: 'S', role: 'admin' });
  assert.equal(sneaky.status, 201);
  assert.equal(sneaky.body.user.role, 'customer');
  assert.equal(queryOne<any>("SELECT role FROM users WHERE email = 'sneaky@x.com'").role, 'customer');
});

test('auth: password reset link is single-use, hashed at rest, same answer for unknown emails, and old links die', async () => {
  const unknown = await api('POST', '/auth/forgot-password', null, { email: 'ghost@nowhere.com' });
  const known = await api('POST', '/auth/forgot-password', null, { email: 'a@test.com' });
  assert.equal(unknown.status, 200);
  assert.deepEqual(unknown.body, known.body, 'identical response, and no token in the response when exposure is off');
  assert.equal(known.body.resetToken, undefined);

  const mail = queryOne<any>("SELECT body, to_email FROM email_outbox WHERE kind = 'RESET' ORDER BY id DESC");
  assert.equal(mail.to_email, 'a@test.com');
  const token = /token=([0-9a-f]{64})/.exec(mail.body)![1];
  const stored = queryOne<any>('SELECT token_hash FROM password_resets ORDER BY id DESC');
  assert.equal(stored.token_hash, crypto.createHash('sha256').update(token).digest('hex'));
  assert.notEqual(stored.token_hash, token);

  const weak = await api('POST', '/auth/reset-password', null, { token, new_password: 'short' });
  assert.equal(weak.status, 400);

  const done = await api('POST', '/auth/reset-password', null, { token, new_password: 'NewPassw0rd!x' });
  assert.equal(done.status, 200);
  assert.equal((await api('POST', '/auth/login', null, { email: 'a@test.com', password: 'NewPassw0rd!x' })).status, 200);
  assert.equal((await api('POST', '/auth/login', null, { email: 'a@test.com', password: PASSWORD })).status, 401);
  assert.equal((await api('POST', '/auth/reset-password', null, { token, new_password: 'AnotherPass1!x' })).status, 400, 'single use');

  // A newer request invalidates the older link.
  await api('POST', '/auth/forgot-password', null, { email: 'b@test.com' });
  const t1 = /token=([0-9a-f]{64})/.exec(queryOne<any>("SELECT body FROM email_outbox WHERE kind='RESET' ORDER BY id DESC").body)![1];
  await api('POST', '/auth/forgot-password', null, { email: 'b@test.com' });
  const t2 = /token=([0-9a-f]{64})/.exec(queryOne<any>("SELECT body FROM email_outbox WHERE kind='RESET' ORDER BY id DESC").body)![1];
  assert.equal((await api('POST', '/auth/reset-password', null, { token: t1, new_password: 'Replaced1!pass' })).status, 400);
  assert.equal((await api('POST', '/auth/reset-password', null, { token: t2, new_password: 'Replaced1!pass' })).status, 200);
});

test('auth: expired reset links are refused', async () => {
  await api('POST', '/auth/forgot-password', null, { email: 'staff@test.com' });
  const token = /token=([0-9a-f]{64})/.exec(queryOne<any>("SELECT body FROM email_outbox WHERE kind='RESET' ORDER BY id DESC").body)![1];
  execute("UPDATE password_resets SET expires_at = '2000-01-01T00:00:00.000Z' WHERE used = 0");
  assert.equal((await api('POST', '/auth/reset-password', null, { token, new_password: 'Valid1!password' })).status, 400);
});

test('auth: missing, forged and tampered tokens are 401; a deactivated user loses access immediately', async () => {
  assert.equal((await api('GET', '/subscriptions')).status, 401);
  assert.equal((await api('GET', '/subscriptions', 'not.a.jwt')).status, 401);
  const forged = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url') + '.' +
    Buffer.from(JSON.stringify({ id: f.adminId, role: 'admin' })).toString('base64url') + '.';
  assert.equal((await api('GET', '/subscriptions', forged)).status, 401);

  const id = Number(execute("INSERT INTO users (email, password_hash, full_name, role) VALUES ('temp@test.com', 'x', 't', 'staff')").lastInsertRowid);
  const login = await api('POST', '/auth/login', null, { email: 'temp@test.com', password: PASSWORD });
  assert.equal(login.status, 401); // bogus hash
  const jwt = (await import('jsonwebtoken')).default.sign({ id, role: 'admin' }, process.env.JWT_SECRET!, { algorithm: 'HS256' });
  assert.equal((await api('GET', '/subscriptions', jwt)).status, 200 /* DB role (staff) wins, not the token's claim */);
  const asAdmin = await api('POST', '/auth/staff', jwt, { email: 'x@x.com', password: 'Abcdefgh!', full_name: 'x' });
  assert.equal(asAdmin.status, 403, 'role comes from the database, not from the token');
  execute('UPDATE users SET active = 0 WHERE id = ?', [id]);
  assert.equal((await api('GET', '/subscriptions', jwt)).status, 401);
});

test('errors: malformed JSON is a clean 400 and server errors never leak internals', async () => {
  const bad = await api('POST', '/auth/login', null, 'not an object');
  assert.equal(bad.status, 400);
  assert.ok(!/at .*\.ts|SQLITE|stack/i.test(bad.text));
  const r = await api('GET', '/subscriptions/abc', f.admin);
  assert.equal(r.status, 404);
});

// ---- RBAC ----------------------------------------------------------------------------------------

test('rbac: only an admin can create staff', async () => {
  const body = { email: 'newstaff@test.com', password: 'Abcdefgh!', full_name: 'New Staff' };
  assert.equal((await api('POST', '/auth/staff', f.staff, body)).status, 403);
  assert.equal((await api('POST', '/auth/staff', f.a, body)).status, 403);
  assert.equal((await api('POST', '/auth/staff', null, body)).status, 401);
  const ok = await api('POST', '/auth/staff', f.admin, body);
  assert.equal(ok.status, 201);
  assert.equal(queryOne<any>("SELECT role FROM users WHERE email = 'newstaff@test.com'").role, 'staff');
  assert.equal((await api('POST', '/auth/staff', f.admin, { ...body, email: 'NewStaff@test.com' })).status, 409);
  assert.equal((await api('POST', '/auth/staff', f.admin, { ...body, email: 'weak@test.com', password: 'weak' })).status, 400);
});

test('rbac: only an admin can create discount rules, and the rule is validated server-side', async () => {
  const rule = { code: 'SAVE10', description: '10% off', discount_type: 'percentage', value: 10, applies_to: 'all', max_uses: 5 };
  assert.equal((await api('POST', '/catalog/discounts', f.staff, rule)).status, 403);
  assert.equal((await api('POST', '/catalog/discounts', f.a, rule)).status, 403);
  assert.equal((await api('POST', '/catalog/discounts', f.admin, rule)).status, 201);
  assert.equal((await api('POST', '/catalog/discounts', f.admin, rule)).status, 409); // duplicate code
  assert.equal((await api('POST', '/catalog/discounts', f.admin, { ...rule, code: 'BAD1', value: 150 })).status, 400);
  assert.equal((await api('POST', '/catalog/discounts', f.admin, { ...rule, code: 'BAD2', discount_type: 'weird' })).status, 400);
  assert.equal((await api('POST', '/catalog/discounts', f.admin, { ...rule, code: 'BAD3', applies_to: 'product' })).status, 400);
  assert.equal((await api('POST', '/catalog/discounts', f.admin, { ...rule, code: 'BAD4', start_date: '2026-05-01', end_date: '2026-01-01' })).status, 400);
});

test('rbac: catalog writes are admin-only; customers cannot read catalog, billing, analytics or staff data; cost price hidden from staff', async () => {
  const product = { name: 'New', type: 'software', sales_price: 10, cost_price: 5 };
  assert.equal((await api('POST', '/catalog/products', f.staff, product)).status, 403);
  assert.equal((await api('POST', '/catalog/plans', f.staff, { name: 'p', billing_interval: 'monthly', price: 1 })).status, 403);
  assert.equal((await api('POST', '/catalog/taxes', f.staff, { name: 't', rate_percentage: 5 })).status, 403);
  assert.equal((await api('POST', '/catalog/quotation-templates', f.staff, { name: 't', plan_id: f.monthlyPlan })).status, 403);
  assert.equal((await api('POST', '/catalog/products', f.admin, product)).status, 201);

  for (const [method, path] of [['GET', '/catalog/products'], ['GET', '/catalog/discounts'], ['GET', '/catalog/plans'], ['GET', '/analytics/summary'],
    ['GET', '/auth/staff'], ['POST', '/billing/run'], ['GET', '/billing/integrity'], ['GET', '/billing/history'], ['GET', '/analytics/export/invoices']] as const) {
    assert.equal((await api(method, path, f.a, method === 'POST' ? {} : undefined)).status, 403, `${method} ${path}`);
  }
  const staffView = await api('GET', '/catalog/products', f.staff);
  assert.equal(staffView.body.products[0].cost_price, undefined);
  const adminView = await api('GET', '/catalog/products', f.admin);
  assert.equal(adminView.body.products[0].cost_price !== undefined, true);

  assert.equal((await api('POST', '/catalog/products', f.admin, { ...product, sales_price: -1 })).status, 400);
  assert.equal((await api('POST', '/catalog/products', f.admin, { ...product, sales_price: '1.999' })).status, 400);
  assert.equal((await api('POST', '/catalog/products', f.admin, { ...product, type: 'nonsense' })).status, 400);
  assert.equal((await api('POST', '/catalog/plans', f.admin, { name: 'p', billing_interval: 'hourly', price: 1 })).status, 400);
  assert.equal((await api('POST', '/catalog/plans', f.admin, { name: 'p', billing_interval: 'monthly', price: 1, start_date: '2026-05-01', end_date: '2026-01-01' })).status, 400);
});

test('rbac: customers cannot create subscriptions, record payments or change invoices', async () => {
  const create = { customer_id: f.custA, plan_id: f.monthlyPlan, lines: [{ product_id: f.productId, variant_id: f.stdVariant, quantity: 1 }] };
  assert.equal((await api('POST', '/subscriptions', f.a, create)).status, 403);
  assert.equal((await api('POST', '/subscriptions', f.a, { ...create, initial_status: 'Active' })).status, 403);
  assert.equal((await api('POST', '/payments', f.a, { invoice_id: invA, amount: 1, payment_method: 'Cash' })).status, 403);
  assert.equal((await api('PATCH', `/billing/invoices/${invA}/status`, f.a, { status: 'Cancelled' })).status, 403);
  const staffCreate = await api('POST', '/subscriptions', f.staff, { ...create, initial_status: 'Active' });
  assert.equal(staffCreate.status, 201);
  assert.equal(queryOne<any>('SELECT status FROM subscriptions WHERE id = ?', [staffCreate.body.subscription.id]).status, 'Draft', 'status can only change via the state machine');
});

// ---- customer isolation ----------------------------------------------------------------------------

test('isolation: a customer reads their own subscription and invoice (200)', async () => {
  assert.equal((await api('GET', `/subscriptions/${subA}`, f.a)).status, 200);
  assert.equal((await api('GET', `/subscriptions/${subA}/timeline`, f.a)).status, 200);
  assert.equal((await api('GET', `/billing/invoices/${invA}`, f.a)).status, 200);
});

test('isolation: another customer\'s subscription, timeline, invoice and actions are 404, identical to a missing id', async () => {
  for (const [method, path, body] of [
    ['GET', `/subscriptions/${subB}`, undefined],
    ['GET', `/subscriptions/${subB}/timeline`, undefined],
    ['POST', `/subscriptions/${subB}/renew`, {}],
    ['PATCH', `/subscriptions/${subB}/status`, { status: 'Closed' }],
    ['GET', `/billing/invoices/${invB}`, undefined]
  ] as const) {
    const foreign = await api(method, path, f.a, body);
    const nonexistent = await api(method, path.replace(/\/(\d+)/, '/999999'), f.a, body);
    assert.equal(foreign.status, 404, `${method} ${path}`);
    assert.deepEqual(foreign.body, nonexistent.body, 'indistinguishable from a record that does not exist');
  }
  assert.equal(queryOne<any>('SELECT status FROM subscriptions WHERE id = ?', [subB]).status, 'Active', 'victim data untouched');
});

test('isolation: lists are forced to the caller, query parameters cannot widen them', async () => {
  const subs = await api('GET', `/subscriptions?customer_id=${f.custB}`, f.a);
  assert.ok(subs.body.subscriptions.length > 0);
  assert.ok(subs.body.subscriptions.every((s: any) => s.customer_id === f.custA));
  const invs = await api('GET', `/billing/invoices?customer_id=${f.custB}&subscription_id=${subB}`, f.a);
  assert.deepEqual(invs.body.invoices, []);
  const paid = await api('POST', '/payments', f.admin, { invoice_id: invB, amount: 100, payment_method: 'Cash' });
  assert.equal(paid.status, 201);
  const pays = await api('GET', `/payments?invoice_id=${invB}`, f.a);
  assert.deepEqual(pays.body.payments, []);
  assert.equal((await api('GET', '/payments', f.b)).body.payments.length, 1);
  const staffList = await api('GET', '/subscriptions', f.staff);
  assert.ok(new Set(staffList.body.subscriptions.map((s: any) => s.customer_id)).size >= 2, 'staff sees everyone');
});

// ---- subscription state machine -----------------------------------------------------------------------

async function draftSub(overrides: Record<string, unknown> = {}) {
  const r = await api('POST', '/subscriptions', f.admin, {
    customer_id: f.custA, plan_id: f.monthlyPlan, start_date: '2026-06-01',
    lines: [{ product_id: f.productId, variant_id: f.stdVariant, quantity: 1, tax_id: f.taxId }], ...overrides
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.subscription.id as number;
}
const move = (id: number, status: string, token = f.admin) => api('PATCH', `/subscriptions/${id}/status`, token, { status });

test('lifecycle: Draft -> Quotation -> Confirmed -> Active -> Closed, and a closed subscription stays closed', async () => {
  const id = await draftSub();
  assert.equal((await move(id, 'Quotation')).status, 200);
  assert.equal((await move(id, 'Confirmed')).status, 200);
  assert.equal((await move(id, 'Active')).status, 200);
  assert.equal((await move(id, 'Closed')).status, 200);
  const sub = queryOne<any>('SELECT status, close_reason, closed_on FROM subscriptions WHERE id = ?', [id]);
  assert.equal(sub.status, 'Closed');
  assert.equal(sub.close_reason, 'EARLY');
  for (const target of ['Active', 'Draft', 'Quotation', 'Confirmed', 'Paused']) {
    assert.equal((await move(id, target)).status, 409, `Closed -> ${target}`);
  }
  const history = queryAll<any>("SELECT metadata_json FROM audit_logs WHERE subscription_id = ? AND event_type = 'SUBSCRIPTION_TRANSITION'", [id]);
  assert.equal(history.length, 4);
});

test('lifecycle: illegal jumps are 409 and change nothing', async () => {
  const id = await draftSub();
  for (const target of ['Active', 'Confirmed', 'Paused']) {
    assert.equal((await move(id, target)).status, 409, `Draft -> ${target}`);
  }
  assert.equal((await move(id, 'Bogus')).status, 400);
  assert.equal(queryOne<any>('SELECT status FROM subscriptions WHERE id = ?', [id]).status, 'Draft');
  await move(id, 'Quotation');
  assert.equal((await move(id, 'Active')).status, 409, 'Quotation -> Active');
  await move(id, 'Confirmed');
  assert.equal((await move(id, 'Quotation')).status, 409, 'Confirmed -> Quotation');
  assert.equal((await move(id, 'Paused')).status, 409, 'Confirmed -> Paused');
});

test('lifecycle: a quotation past its validity can no longer be confirmed', async () => {
  const id = await draftSub();
  await move(id, 'Quotation');
  execute("UPDATE subscriptions SET quotation_valid_until = '2000-01-01' WHERE id = ?", [id]);
  const r = await move(id, 'Confirmed');
  assert.equal(r.status, 409);
  assert.match(r.body.error, /expired/);
});

test('lifecycle: activation starts the billing cursor at the start date; billing then works end to end', async () => {
  const id = await draftSub({ start_date: '2026-06-15' });
  for (const s of ['Quotation', 'Confirmed', 'Active']) await move(id, s);
  const sub = queryOne<any>('SELECT next_billing_date AS d, next_period_index AS i FROM subscriptions WHERE id = ?', [id]);
  assert.deepEqual([sub.d, sub.i], ['2026-06-15', 0]);
  const run = await api('POST', '/billing/run', f.staff, { as_of_date: '2026-06-15' });
  assert.equal(run.status, 200);
  assert.ok(run.body.result.invoicesCreated >= 1);
});

test('lifecycle: plan policy flags are enforced for every role (pause / close early / renew)', async () => {
  const locked = newPlan('monthly', { can_pause: 0, can_renew: 0, can_close_early: 0 });
  const id = newSubscription({ customer: f.custA, plan: locked, start: '2026-07-01', expiry: '2027-07-01', lines: [{ product: f.productId, unit: 10 }] });
  for (const token of [f.a, f.admin]) {
    const pause = await move(id, 'Paused', token);
    assert.equal(pause.status, 409);
    assert.match(pause.body.error, /does not allow pausing/);
    assert.equal((await move(id, 'Closed', token)).status, 409);
    assert.equal((await api('POST', `/subscriptions/${id}/renew`, token, {})).status, 409);
  }
  const open = newSubscription({ customer: f.custA, plan: f.monthlyPlan, start: '2026-07-01', expiry: '2027-07-01', lines: [{ product: f.productId, unit: 10 }] });
  const renew = await api('POST', `/subscriptions/${open}/renew`, f.a, {});
  assert.equal(renew.status, 200);
  assert.equal(renew.body.newExpiry, '2027-08-01');
});

test('lifecycle: customers may pause/resume/close their own subscription but never confirm or activate it', async () => {
  const id = newSubscription({ customer: f.custA, plan: f.monthlyPlan, start: '2026-08-01', lines: [{ product: f.productId, unit: 10 }] });
  assert.equal((await move(id, 'Paused', f.a)).status, 200);
  assert.equal((await move(id, 'Active', f.a)).status, 200);
  assert.equal((await move(id, 'Confirmed', f.a)).status, 403);
  assert.equal((await move(id, 'Draft', f.a)).status, 403);
  assert.equal((await move(id, 'Closed', f.a)).status, 200);
  assert.equal((await move(id, 'Active', f.a)).status, 403, 'a customer cannot reopen a closed subscription');
  assert.equal((await api('POST', `/subscriptions/${id}/renew`, f.a, {})).status, 409, 'closed subscriptions cannot be renewed');
});

test('plans: availability window and per-line minimum quantity are enforced when creating a subscription', async () => {
  const windowed = Number((execute("INSERT INTO plans (name, billing_interval, price, min_quantity, start_date, end_date) VALUES ('Window', 'monthly', 0, 5, '2027-01-01', '2027-12-31')")).lastInsertRowid);
  const base = { customer_id: f.custA, plan_id: windowed, lines: [{ product_id: f.productId, variant_id: f.stdVariant, quantity: 5 }] };
  assert.equal((await api('POST', '/subscriptions', f.admin, { ...base, start_date: '2026-06-01' })).status, 400);
  assert.equal((await api('POST', '/subscriptions', f.admin, { ...base, start_date: '2028-06-01' })).status, 400);
  assert.equal((await api('POST', '/subscriptions', f.admin, { ...base, start_date: '2027-06-01', lines: [{ ...base.lines[0], quantity: 4 }] })).status, 400);
  assert.equal((await api('POST', '/subscriptions', f.admin, { ...base, start_date: '2027-06-01' })).status, 201);
  assert.equal((await api('POST', '/subscriptions', f.admin, { ...base, start_date: '2027-06-01', payment_terms: 'whenever' })).status, 400);
  assert.equal((await api('POST', '/subscriptions', f.admin, { ...base, start_date: '2027-06-01', customer_id: f.staffId })).status, 400, 'staff is not a customer');
});

// ---- invoices & payments --------------------------------------------------------------------------

async function confirmedInvoice(unit: number, start: string) {
  const sub = newSubscription({ customer: f.custA, plan: f.monthlyPlan, start, taxId: f.taxId, lines: [{ product: f.productId, unit }] });
  runBillingCycle(start);
  const inv = queryOne<any>('SELECT id, total_amount FROM invoices WHERE subscription_id = ?', [sub]);
  assert.equal((await api('PATCH', `/billing/invoices/${inv.id}/status`, f.staff, { status: 'Confirmed' })).status, 200);
  return inv as { id: number; total_amount: number };
}

test('payments: partial then full payment moves Confirmed -> Paid with exact outstanding amounts', async () => {
  const inv = await confirmedInvoice(8474.58, '2040-01-01'); // total 10,000.00 with 18% tax
  assert.equal(inv.total_amount, 10000);
  const p1 = await api('POST', '/payments', f.staff, { invoice_id: inv.id, amount: '4000', payment_method: 'UPI', note: 'first half' });
  assert.equal(p1.status, 201);
  assert.equal(p1.body.payment.balanceRemaining, 6000);
  assert.equal(p1.body.payment.status, 'Confirmed');
  const list = await api('GET', '/billing/invoices?status=Confirmed', f.staff);
  assert.equal(list.body.invoices.find((i: any) => i.id === inv.id).balance_due, 6000);

  const p2 = await api('POST', '/payments', f.staff, { invoice_id: inv.id, amount: 6000, payment_method: 'Bank Transfer', payment_date: '2040-02-01' });
  assert.equal(p2.body.payment.balanceRemaining, 0);
  assert.equal(p2.body.payment.status, 'Paid');
  const row = queryOne<any>('SELECT status, amount_paid FROM invoices WHERE id = ?', [inv.id]);
  assert.deepEqual([row.status, row.amount_paid], ['Paid', 10000]);
  assert.equal(buildIntegrityReport().inconsistentPayments, 0);
});

test('payments: overpayment, zero, negative, junk, bad method, Draft and Paid invoices are all refused', async () => {
  const inv = await confirmedInvoice(100, '2041-01-01'); // total 118
  const pay = (body: Record<string, unknown>) => api('POST', '/payments', f.staff, { invoice_id: inv.id, payment_method: 'Cash', ...body });
  assert.equal((await pay({ amount: 118.01 })).status, 409);
  assert.equal((await pay({ amount: 0 })).status, 400);
  assert.equal((await pay({ amount: -5 })).status, 400);
  assert.equal((await pay({ amount: 'abc' })).status, 400);
  assert.equal((await pay({ amount: 10.123 })).status, 400);
  assert.equal((await pay({ amount: 10, payment_method: 'Bitcoin' })).status, 400);
  assert.equal((await api('POST', '/payments', f.staff, { invoice_id: 999999, amount: 1, payment_method: 'Cash' })).status, 404);
  assert.equal((await pay({ amount: 0.1 })).status, 201);
  assert.equal((await pay({ amount: 0.2 })).status, 201);
  assert.equal(queryOne<any>('SELECT amount_paid FROM invoices WHERE id = ?', [inv.id]).amount_paid, 0.3, 'float-trap amounts add up exactly');
  assert.equal((await pay({ amount: 117.7 })).status, 201);
  assert.equal((await pay({ amount: 0.01 })).status, 409, 'already paid');

  const draftSub = newSubscription({ customer: f.custA, plan: f.monthlyPlan, start: '2041-06-01', lines: [{ product: f.productId, unit: 10 }] });
  runBillingCycle('2041-06-01');
  const draft = queryOne<any>('SELECT id FROM invoices WHERE subscription_id = ?', [draftSub]);
  assert.equal((await api('POST', '/payments', f.staff, { invoice_id: draft.id, amount: 1, payment_method: 'Cash' })).status, 409, 'confirm first');
});

test('invoices: lifecycle rules - Paid only through payments, cancel blocked once paid, terminal states stay terminal', async () => {
  const inv = await confirmedInvoice(100, '2042-01-01');
  const st = (status: string) => api('PATCH', `/billing/invoices/${inv.id}/status`, f.staff, { status });
  assert.equal((await st('Paid')).status, 409);
  assert.equal((await st('Draft')).status, 409);
  await api('POST', '/payments', f.staff, { invoice_id: inv.id, amount: 10, payment_method: 'Cash' });
  assert.equal((await st('Cancelled')).status, 409, 'payments exist');

  const sub = newSubscription({ customer: f.custA, plan: f.monthlyPlan, start: '2042-06-01', lines: [{ product: f.productId, unit: 10 }] });
  runBillingCycle('2042-06-01');
  const d = queryOne<any>('SELECT id FROM invoices WHERE subscription_id = ?', [sub]);
  const cancel = await api('PATCH', `/billing/invoices/${d.id}/status`, f.staff, { status: 'Cancelled' });
  assert.equal(cancel.status, 200);
  assert.equal((await api('PATCH', `/billing/invoices/${d.id}/status`, f.staff, { status: 'Confirmed' })).status, 409);
  assert.equal(runBillingCycle('2042-06-01').invoicesCreated, 0, 'a cancelled invoice keeps its period and is never regenerated');
});

test('billing API: run twice via HTTP shows N created then 0, integrity endpoint reports clean; dry run persists nothing', async () => {
  newSubscription({ customer: f.custA, plan: f.monthlyPlan, start: '2043-01-01', lines: [{ product: f.productId, unit: 10 }] });
  const dry = await api('POST', '/billing/run', f.admin, { as_of_date: '2043-02-01', dry_run: true });
  assert.equal(dry.body.result.dryRun, true);
  const first = await api('POST', '/billing/run', f.admin, { as_of_date: '2043-02-01' });
  const second = await api('POST', '/billing/run', f.admin, { as_of_date: '2043-02-01' });
  assert.equal(first.body.result.invoicesCreated, dry.body.result.invoicesCreated);
  assert.ok(first.body.result.invoicesCreated >= 2);
  assert.equal(second.body.result.invoicesCreated, 0);
  const integrity = await api('GET', '/billing/integrity', f.staff);
  assert.equal(integrity.body.report.ok, true);
  assert.equal(integrity.body.report.duplicatePeriods, 0);
  assert.equal(integrity.body.report.missingPeriods, 0);
  assert.equal((await api('POST', '/billing/run', f.admin, { as_of_date: 'tomorrow' })).status, 400);
});

test('dashboard: aggregates are exact and overdue means Confirmed, unpaid balance, past due date', async () => {
  const sub = newSubscription({ customer: f.custB, plan: f.monthlyPlan, start: '2020-01-01', terms: '15 Days Net', taxId: f.taxId, lines: [{ product: f.productId, unit: 33.33, qty: 3 }] });
  runBillingCycle('2020-01-01', { autoConfirm: true });
  const inv = queryOne<any>('SELECT id, total_amount FROM invoices WHERE subscription_id = ?', [sub]);
  await api('POST', '/payments', f.staff, { invoice_id: inv.id, amount: 20, payment_method: 'Cheque' });

  const summary = await api('GET', '/analytics/summary', f.staff);
  assert.equal(summary.status, 200);
  const m = summary.body.metrics;
  const expected = queryOne<any>("SELECT ROUND(SUM(total_amount),2) AS t, ROUND(SUM(amount_paid),2) AS p FROM invoices WHERE status IN ('Confirmed','Paid')");
  assert.equal(m.financials.totalInvoiced, expected.t);
  assert.equal(m.financials.totalCollected, expected.p);
  assert.equal(m.financials.totalOwed, Math.round((expected.t - expected.p) * 100) / 100);
  assert.ok(summary.body.overdueInvoices.some((o: any) => o.id === inv.id && o.balance_due === Math.round((inv.total_amount - 20) * 100) / 100));
  assert.equal(m.subscriptions.active, queryOne<any>("SELECT COUNT(*) AS n FROM subscriptions WHERE status = 'Active'").n);
  const overdueFilter = await api('GET', '/billing/invoices?overdue=true', f.staff);
  assert.ok(overdueFilter.body.invoices.every((i: any) => i.is_overdue === 1 && i.status === 'Confirmed'));
  const paged = await api('GET', '/billing/invoices?page=1&page_size=2', f.staff);
  assert.equal(paged.body.invoices.length, 2);
  assert.ok(paged.body.pagination.total > 2);
});

test('timeline: shows only the subscription\'s own events in chronological order', async () => {
  const id = await draftSub();
  await move(id, 'Quotation');
  const other = await draftSub();
  await move(other, 'Quotation');
  const t = await api('GET', `/subscriptions/${id}/timeline`, f.admin);
  assert.equal(t.status, 200);
  const statuses = t.body.timeline.filter((e: any) => e.type === 'status_change');
  assert.deepEqual(statuses.map((e: any) => e.to), ['Quotation']);
});

test('exports: CSV fields are quoted and spreadsheet formulas are neutralised', async () => {
  execute("UPDATE users SET full_name = '=HYPERLINK(\"evil\")' WHERE id = ?", [f.custB]);
  const csv = await api('GET', '/analytics/export/invoices', f.staff);
  assert.equal(csv.status, 200);
  assert.ok(csv.text.includes(`"'=HYPERLINK(""evil"")"`));
  assert.ok(!csv.text.includes(',"=HYPERLINK'));
  execute("UPDATE users SET full_name = 'b@test.com' WHERE id = ?", [f.custB]);
});

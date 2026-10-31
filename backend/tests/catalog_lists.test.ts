import { api, baseFixture, closeServer, execute, newPlan, newProduct, newSubscription, queryAll, queryOne, Fixture } from './helpers.js';
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { getStatementCount } from '../src/db/database.js';
import { runBillingCycle } from '../src/services/billingEngine.js';

let f: Fixture;
before(async () => { f = await baseFixture(); });
after(closeServer);

// ---- catalog: products, variants, plans ---------------------------------------------------------

test('catalog: admin creates a product with variants; brand variant adds exactly 560 to a 1000 product', async () => {
  const created = await api('POST', '/catalog/products', f.admin, {
    name: 'Odoo Suite', type: 'software', sales_price: '1000.00', cost_price: 400, notes: 'flagship',
    variants: [{ attribute_name: 'Brand', option_name: 'Generic', price_extra: 0 }, { attribute_name: 'Brand', option_name: 'Odoo', price_extra: 560 }]
  });
  assert.equal(created.status, 201);
  const productId = created.body.productId;
  const variants = queryAll<any>('SELECT id, option_name, price_extra FROM product_variants WHERE product_id = ? ORDER BY id', [productId]);
  assert.deepEqual(variants.map(v => v.price_extra), [0, 560]);

  const sub = await api('POST', '/subscriptions', f.staff, {
    customer_id: f.custA, plan_id: f.monthlyPlan, start_date: '2026-01-01',
    lines: [{ product_id: productId, variant_id: variants[1].id, quantity: 2 }]
  });
  assert.equal(sub.status, 201);
  const line = queryOne<any>('SELECT unit_price, line_amount FROM subscription_lines WHERE subscription_id = ?', [sub.body.subscription.id]);
  assert.deepEqual([line.unit_price, line.line_amount], [1560, 3120]);
});

test('catalog: variants can be added later; duplicates, unknown products and negative extras are rejected', async () => {
  const productId = newProduct(100);
  assert.equal((await api('POST', `/catalog/products/${productId}/variants`, f.admin, { attribute_name: 'Size', option_name: 'XL', price_extra: 5 })).status, 201);
  assert.equal((await api('POST', `/catalog/products/${productId}/variants`, f.admin, { attribute_name: 'Size', option_name: 'XL', price_extra: 5 })).status, 409);
  assert.equal((await api('POST', `/catalog/products/${productId}/variants`, f.admin, { attribute_name: 'Size', option_name: 'S', price_extra: -5 })).status, 400);
  assert.equal((await api('POST', '/catalog/products/999999/variants', f.admin, { attribute_name: 'a', option_name: 'b' })).status, 404);
  assert.equal((await api('POST', `/catalog/products/${productId}/variants`, f.staff, { attribute_name: 'a', option_name: 'b' })).status, 403);
  // a product with a bad variant is not half-created
  const before = queryOne<any>('SELECT COUNT(*) AS n FROM products')!.n;
  const bad = await api('POST', '/catalog/products', f.admin, { name: 'Broken', type: 'addon', sales_price: 1, cost_price: 1, variants: [{ attribute_name: 'x' }] });
  assert.equal(bad.status, 400);
  assert.equal(queryOne<any>('SELECT COUNT(*) AS n FROM products')!.n, before);
});

test('plans: every cadence bills on its own boundaries (daily, weekly, monthly, yearly)', () => {
  const lines = [{ product: f.productId, unit: 10 }];
  const subs = {
    daily: newSubscription({ customer: f.custA, plan: newPlan('daily'), start: '2050-02-27', lines }),
    weekly: newSubscription({ customer: f.custA, plan: newPlan('weekly'), start: '2050-02-27', lines }),
    monthly: newSubscription({ customer: f.custA, plan: newPlan('monthly'), start: '2050-01-31', lines }),
    yearly: newSubscription({ customer: f.custA, plan: newPlan('yearly'), start: '2048-02-29', lines })
  };
  execute(`UPDATE subscriptions SET status = 'Closed' WHERE status = 'Active' AND id NOT IN (${Object.values(subs).join(',')})`);
  runBillingCycle('2050-03-01');
  const starts = (id: number) => queryAll<any>('SELECT period_start, period_end FROM invoices WHERE subscription_id = ? ORDER BY period_index', [id]);
  assert.deepEqual(starts(subs.daily).map(i => i.period_start), ['2050-02-27', '2050-02-28', '2050-03-01']);
  assert.deepEqual(starts(subs.weekly).map(i => i.period_start), ['2050-02-27']);
  assert.deepEqual(starts(subs.monthly).map(i => [i.period_start, i.period_end]), [['2050-01-31', '2050-02-28'], ['2050-02-28', '2050-03-31']]);
  assert.deepEqual(starts(subs.yearly).map(i => i.period_start), ['2048-02-29', '2049-02-28', '2050-02-28']);
});

test('plans: invalid configurations are rejected by the API and by the database', async () => {
  const plan = { name: 'P', billing_interval: 'monthly', price: 10 };
  assert.equal((await api('POST', '/catalog/plans', f.admin, { ...plan, min_quantity: 0 })).status, 400);
  assert.equal((await api('POST', '/catalog/plans', f.admin, { ...plan, price: -1 })).status, 400);
  assert.equal((await api('POST', '/catalog/plans', f.admin, { ...plan, start_date: '2026-13-45' })).status, 400);
  assert.equal((await api('POST', '/catalog/plans', f.admin, { ...plan, can_pause: 'maybe' })).status, 400);
  assert.equal((await api('POST', '/catalog/plans', f.admin, { ...plan, min_quantity: 3, can_pause: false, auto_close: true })).status, 201);
  assert.throws(() => execute("INSERT INTO plans (name, billing_interval, price, start_date, end_date) VALUES ('x','monthly',1,'2026-05-01','2026-01-01')"), /CHECK/);
});

// ---- lists: pagination, filters, no per-row queries -------------------------------------------------

test('lists: every list is paginated by default and the page size is capped', async () => {
  for (let i = 0; i < 230; i++) newSubscription({ customer: f.custB, plan: f.monthlyPlan, start: '2060-01-01', status: 'Draft', lines: [{ product: f.productId, unit: 1 }] });
  const first = await api('GET', '/subscriptions', f.staff);
  assert.equal(first.body.subscriptions.length, 100);
  assert.equal(first.body.pagination.pageSize, 100);
  assert.ok(first.body.pagination.total >= 230);
  const second = await api('GET', '/subscriptions?page=2', f.staff);
  assert.ok(second.body.subscriptions.length >= 100);
  assert.equal(new Set([...first.body.subscriptions, ...second.body.subscriptions].map((s: any) => s.id)).size,
    first.body.subscriptions.length + second.body.subscriptions.length, 'pages do not overlap');
  const huge = await api('GET', '/subscriptions?page_size=100000', f.staff);
  assert.equal(huge.body.subscriptions.length, 200);
  const junk = await api('GET', '/subscriptions?page=-4&page_size=abc', f.staff);
  assert.equal(junk.status, 200);
  assert.equal(junk.body.pagination.page, 1);
});

test('lists: filters work together and customers stay inside their own data', async () => {
  const s = newSubscription({ customer: f.custA, plan: f.monthlyPlan, start: '2061-01-01', taxId: f.taxId, lines: [{ product: f.productId, unit: 100 }] });
  runBillingCycle('2061-02-01', { autoConfirm: true });
  const inv = queryOne<any>('SELECT invoice_number, issue_date FROM invoices WHERE subscription_id = ? ORDER BY id LIMIT 1', [s])!;

  const byNumber = await api('GET', `/billing/invoices?q=${inv.invoice_number}`, f.staff);
  assert.deepEqual(byNumber.body.invoices.map((i: any) => i.invoice_number), [inv.invoice_number]);
  const wild = await api('GET', '/billing/invoices?q=*', f.staff);
  assert.equal(wild.status, 200); // wildcard characters are stripped, not interpreted
  const range = await api('GET', '/billing/invoices?from=2061-02-01&to=2061-02-01&status=Confirmed', f.staff);
  assert.ok(range.body.invoices.length >= 1 && range.body.invoices.every((i: any) => i.issue_date === '2061-02-01' && i.status === 'Confirmed'));
  assert.equal((await api('GET', '/billing/invoices?from=2061-02-30', f.staff)).status, 400);
  assert.equal((await api('GET', '/billing/invoices?from=2061-03-01&to=2061-02-01', f.staff)).status, 400);
  assert.equal((await api('GET', '/billing/invoices?status=Bogus', f.staff)).status, 400);

  const mine = await api('GET', `/billing/invoices?q=${inv.invoice_number}`, f.b);
  assert.deepEqual(mine.body.invoices, [], 'customer B cannot find customer A\'s invoice by searching its number');
  const subSearch = await api('GET', `/subscriptions?q=${queryOne<any>('SELECT subscription_number AS n FROM subscriptions WHERE id = ?', [s]).n}`, f.staff);
  assert.equal(subSearch.body.subscriptions.length, 1);

  const pay = await api('POST', '/payments', f.staff, { invoice_id: queryOne<any>('SELECT id FROM invoices WHERE subscription_id = ?', [s]).id, amount: 5, payment_method: 'UPI', payment_date: '2061-02-02' });
  assert.equal(pay.status, 201);
  const pays = await api('GET', '/payments?from=2061-02-01&to=2061-02-28&method=UPI', f.staff);
  assert.equal(pays.body.payments.length, 1);
  assert.equal(pays.body.pagination.total, 1);
  assert.equal((await api('GET', '/payments?method=Gold', f.staff)).status, 400);
});

test('lists: query count does not grow with the number of rows returned (no N+1)', async () => {
  const count = async (path: string, token: string) => {
    const before = getStatementCount();
    const r = await api('GET', path, token);
    assert.equal(r.status, 200);
    return getStatementCount() - before;
  };
  for (const [name, small, large, token] of [
    ['subscriptions', '/subscriptions?page_size=2', '/subscriptions?page_size=150', f.staff],
    ['invoices', '/billing/invoices?page_size=2', '/billing/invoices?page_size=150', f.staff],
    ['payments', '/payments?page_size=1', '/payments?page_size=150', f.staff]
  ] as const) {
    const a = await count(small, token);
    const b = await count(large, token);
    assert.equal(a, b, `${name}: ${a} statements for a small page vs ${b} for a large page`);
    assert.ok(b <= 4, `${name} uses ${b} statements`);
  }
  assert.ok(await count('/analytics/summary', f.staff) <= 12, 'dashboard is a fixed handful of aggregate queries');
});

test('billing: statements per billing run scale with subscriptions, not with lines or periods', () => {
  const mk = (lineCount: number) => {
    const ids: number[] = [];
    for (let i = 0; i < 10; i++) {
      ids.push(newSubscription({
        customer: f.custA, plan: f.monthlyPlan, start: '2070-01-01',
        lines: Array.from({ length: lineCount }, () => ({ product: f.productId, unit: 5 }))
      }));
    }
    return ids;
  };
  execute("UPDATE subscriptions SET status = 'Closed' WHERE status = 'Active'");
  mk(1);
  const b1 = getStatementCount();
  runBillingCycle('2070-01-01', { dryRun: true });
  const oneLine = getStatementCount() - b1;
  execute("UPDATE subscriptions SET status = 'Closed' WHERE status = 'Active'");
  mk(8);
  const b2 = getStatementCount();
  runBillingCycle('2070-01-01', { dryRun: true });
  const eightLines = getStatementCount() - b2;
  // Per-line statements are the unavoidable inserts; the reads are batched, so growth is at most one insert per extra line.
  assert.ok(eightLines - oneLine <= 10 * 7 + 2, `1 line: ${oneLine} statements, 8 lines: ${eightLines}`);
});

test('dashboard: period filter changes invoiced/collected but not the receivables book', async () => {
  const s = newSubscription({ customer: f.custA, plan: f.monthlyPlan, start: '2062-01-01', taxId: f.taxId, lines: [{ product: f.productId, unit: 1000 }] });
  runBillingCycle('2062-01-01', { autoConfirm: true });
  const inv = queryOne<any>('SELECT id, total_amount FROM invoices WHERE subscription_id = ?', [s])!;
  await api('POST', '/payments', f.staff, { invoice_id: inv.id, amount: 100, payment_method: 'Cash', payment_date: '2062-01-10' });

  const all = (await api('GET', '/analytics/summary', f.staff)).body.metrics;
  const inRange = (await api('GET', '/analytics/summary?from=2062-01-01&to=2062-01-31', f.staff)).body.metrics;
  const outside = (await api('GET', '/analytics/summary?from=2063-01-01&to=2063-12-31', f.staff)).body.metrics;
  assert.equal(inRange.financials.totalInvoiced, 1180);
  assert.equal(inRange.financials.totalCollected, 100);
  assert.equal(outside.financials.totalInvoiced, 0);
  assert.equal(outside.financials.totalCollected, 0);
  assert.equal(inRange.financials.totalOwed, all.financials.totalOwed, 'owed is as-of-today, independent of the period');
  assert.ok(all.financials.totalInvoiced >= 1180);
  assert.equal((await api('GET', '/analytics/summary?from=nope', f.staff)).status, 400);
});

// ---- quotation templates, tax edits, invoice dispatch ---------------------------------------------

test('quotation: a template copies its plan and lines, and the quotation validity comes from the template', async () => {
  const tpl = await api('POST', '/catalog/quotation-templates', f.admin, {
    name: 'Starter', plan_id: f.monthlyPlan, validity_days: 14,
    lines: [{ product_id: f.productId, variant_id: f.odooVariant, default_quantity: 3 }]
  });
  assert.equal(tpl.status, 201);
  assert.equal((await api('POST', '/catalog/quotation-templates', f.staff, { name: 'x', plan_id: f.monthlyPlan })).status, 403);

  const sub = await api('POST', '/subscriptions', f.staff, { template_id: tpl.body.templateId, customer_id: f.custA, start_date: '2064-01-01' });
  assert.equal(sub.status, 201);
  const id = sub.body.subscription.id;
  const lines = queryAll<any>('SELECT quantity, unit_price FROM subscription_lines WHERE subscription_id = ?', [id]);
  assert.deepEqual(lines.map(l => [l.quantity, l.unit_price]), [[3, 1560]]);
  assert.equal(queryOne<any>('SELECT plan_id FROM subscriptions WHERE id = ?', [id]).plan_id, f.monthlyPlan);

  assert.equal((await api('PATCH', `/subscriptions/${id}/status`, f.staff, { status: 'Quotation' })).status, 200);
  const q = queryOne<any>('SELECT quotation_sent_on AS sent, quotation_valid_until AS until FROM subscriptions WHERE id = ?', [id]);
  const days = Math.round((Date.parse(q.until) - Date.parse(q.sent)) / 86400000);
  assert.equal(days, 14);
});

test('tax: an admin edit applies to the next invoice and never rewrites an issued one', async () => {
  const taxId = Number(execute("INSERT INTO tax_rules (name, rate_percentage) VALUES ('Edit me', 10)").lastInsertRowid);
  const s = newSubscription({ customer: f.custA, plan: f.monthlyPlan, start: '2065-01-01', lines: [{ product: f.productId, unit: 100, tax: taxId }] });
  execute(`UPDATE subscriptions SET status = 'Closed' WHERE status = 'Active' AND id <> ${s}`);
  runBillingCycle('2065-01-01');
  assert.equal((await api('PATCH', `/catalog/taxes/${taxId}`, f.staff, { rate_percentage: 20 })).status, 403);
  assert.equal((await api('PATCH', `/catalog/taxes/${taxId}`, f.admin, { rate_percentage: 150 })).status, 400);
  assert.equal((await api('PATCH', `/catalog/taxes/${taxId}`, f.admin, { rate_percentage: 20 })).status, 200);
  runBillingCycle('2065-02-01');
  const taxes = queryAll<any>('SELECT tax_amount FROM invoices WHERE subscription_id = ? ORDER BY period_index', [s]).map(i => i.tax_amount);
  assert.deepEqual(taxes, [10, 20]);
});

test('invoices: sending an invoice writes the email to the outbox and the audit log; customers cannot send', async () => {
  const s = newSubscription({ customer: f.custB, plan: f.monthlyPlan, start: '2066-01-01', lines: [{ product: f.productId, unit: 50 }] });
  runBillingCycle('2066-01-01');
  const inv = queryOne<any>('SELECT id, invoice_number FROM invoices WHERE subscription_id = ?', [s])!;
  assert.equal((await api('POST', `/billing/invoices/${inv.id}/send`, f.b, {})).status, 403);
  assert.equal((await api('POST', `/billing/invoices/${inv.id}/send`, f.staff, {})).status, 409, 'a Draft invoice is not sent to the customer');
  await api('PATCH', `/billing/invoices/${inv.id}/status`, f.staff, { status: 'Confirmed' });
  const sent = await api('POST', `/billing/invoices/${inv.id}/send`, f.staff, {});
  assert.equal(sent.status, 200);
  const mail = queryOne<any>("SELECT to_email, subject FROM email_outbox WHERE kind = 'INVOICE' ORDER BY id DESC")!;
  assert.deepEqual([mail.to_email, mail.subject], ['b@test.com', `Invoice ${inv.invoice_number} from Brightloop`]);
  assert.equal(queryAll<any>("SELECT id FROM audit_logs WHERE event_type = 'INVOICE_SENT' AND invoice_id = ?", [inv.id]).length, 1);
});

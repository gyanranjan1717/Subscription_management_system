/**
 * Reproducible performance benchmark.
 *   npm --prefix backend run benchmark            (default dataset)
 *   BENCH_SCALE=0.2 npm --prefix backend run benchmark   (smaller smoke run)
 *
 * Builds a representative dataset in a throw-away SQLite file (WAL, same schema as production),
 * then times the real HTTP endpoints through the real Express app, plus a real billing run.
 * Nothing here is estimated: every number printed is measured on the machine running it.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';

const SCALE = Number(process.env.BENCH_SCALE || 1);
const DB_FILE = path.join(os.tmpdir(), `brightloop-bench-${process.pid}.sqlite`);
process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = DB_FILE;
process.env.JWT_SECRET = 'benchmark-secret-benchmark-secret';
for (const ext of ['', '-wal', '-shm']) fs.rmSync(DB_FILE + ext, { force: true });

const N_CUSTOMERS = Math.round(2000 * SCALE);
const N_SUBS = Math.round(5000 * SCALE);
const N_DUE = Math.round(500 * SCALE);
const RUNS = 20;

async function main() {
  const { getDb, queryOne } = await import('../src/db/database.js');
  const { generateToken } = await import('../src/middleware/auth.js');
  const { default: app } = await import('../src/server.js');
  const { periodStart, addMonthsClamped, addDays, todayIso } = await import('../src/lib/dates.js');
  const { runBillingCycle } = await import('../src/services/billingEngine.js');
  const { buildIntegrityReport } = await import('../src/services/integrityService.js');

  const db = getDb();
  const today = todayIso();

  // ---- deterministic data set -------------------------------------------------------------------
  let seed = 12345;
  const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const pick = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)];

  const t0 = performance.now();
  db.exec('BEGIN');
  const user = db.prepare("INSERT INTO users (email, password_hash, full_name, role, company_name) VALUES (?, 'x', ?, ?, ?)");
  const adminId = Number(user.run('admin@bench.test', 'Bench Admin', 'admin', null).lastInsertRowid);
  const staffId = Number(user.run('staff@bench.test', 'Bench Staff', 'staff', null).lastInsertRowid);
  const customers: number[] = [];
  for (let i = 0; i < N_CUSTOMERS; i++) customers.push(Number(user.run(`customer${i}@bench.test`, `Customer ${i}`, 'customer', `Company ${i}`).lastInsertRowid));

  const taxId = Number(db.prepare("INSERT INTO tax_rules (name, rate_percentage, is_default) VALUES ('GST 18%', 18, 1)").run().lastInsertRowid);
  const productId = Number(db.prepare("INSERT INTO products (name, type, sales_price, cost_price) VALUES ('Bench ERP', 'software', 100, 10)").run().lastInsertRowid);
  const planIds = (['monthly', 'monthly', 'yearly', 'weekly'] as const).map((iv, i) =>
    Number(db.prepare('INSERT INTO plans (name, billing_interval, price, min_quantity) VALUES (?, ?, 0, 1)').run(`Plan ${i}`, iv).lastInsertRowid));

  const insSub = db.prepare(
    `INSERT INTO subscriptions (subscription_number, customer_id, plan_id, status, start_date, next_period_index, next_billing_date, payment_terms)
     VALUES (?, ?, ?, ?, ?, ?, ?, '30 Days Net')`
  );
  const insLine = db.prepare('INSERT INTO subscription_lines (subscription_id, product_id, quantity, unit_price, tax_id, line_amount) VALUES (?, ?, ?, 100, ?, ?)');
  const insInv = db.prepare(
    `INSERT INTO invoices (invoice_number, subscription_id, customer_id, period_index, period_start, period_end, subtotal, tax_amount,
                           discount_amount, total_amount, amount_paid, status, issue_date, due_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`
  );
  const insInvLine = db.prepare(
    `INSERT INTO invoice_lines (invoice_id, kind, product_id, description, quantity, unit_price, gross_amount, discount_amount, net_amount,
                                tax_name, tax_rate, tax_amount, line_total) VALUES (?, 'PRODUCT', ?, 'Bench ERP', ?, 100, ?, 0, ?, 'GST 18%', 18, ?, ?)`
  );
  const insPay = db.prepare("INSERT INTO payments (invoice_id, amount, payment_method, payment_date) VALUES (?, ?, ?, ?)");
  const methods = ['Bank Transfer', 'Credit Card', 'UPI', 'Cash', 'Cheque'];

  let invoiceSeq = 0;
  let nInvoices = 0;
  let nPayments = 0;
  const statuses = ['Active', 'Active', 'Active', 'Active', 'Active', 'Active', 'Active', 'Active', 'Paused', 'Closed'];

  for (let i = 0; i < N_SUBS; i++) {
    const status = i < N_DUE ? 'Active' : pick(statuses);
    const planId = i < N_DUE ? planIds[0] : pick(planIds);
    const interval = planId === planIds[2] ? 'yearly' : planId === planIds[3] ? 'weekly' : 'monthly';
    const billed = 1 + Math.floor(rand() * 8); // periods already billed
    const start = interval === 'yearly' ? addMonthsClamped(today, -12 * Math.min(billed, 4))
      : interval === 'weekly' ? addDays(today, -7 * billed) : addMonthsClamped(today, -billed);
    const isDue = i < N_DUE;
    // due subscriptions have their period `billed` starting today and not yet invoiced
    const cursor = isDue || status !== 'Active' ? Math.min(billed, interval === 'yearly' ? 4 : billed) : Math.min(billed, interval === 'yearly' ? 4 : billed) + 1;
    const customer = customers[i % customers.length];
    const subId = Number(insSub.run(`SUB-B-${i}`, customer, planId, status, start, cursor, periodStart(start, interval as any, cursor)).lastInsertRowid);
    const qty = 1 + (i % 4);
    insLine.run(subId, productId, qty, taxId, qty * 100);
    insLine.run(subId, productId, 1, taxId, 100);

    const lines = [qty, 1];
    const gross = (qty + 1) * 10000; // cents
    const tax = Math.round(gross * 0.18);
    for (let k = 0; k < cursor; k++) {
      const ps = periodStart(start, interval as any, k);
      const pe = periodStart(start, interval as any, k + 1);
      const roll = rand();
      const paid = roll < 0.62; const partial = !paid && roll < 0.72;
      const st = paid ? 'Paid' : status === 'Closed' && !paid ? 'Cancelled' : 'Confirmed';
      const total = (gross + tax) / 100;
      const amountPaid = st === 'Cancelled' ? 0 : paid ? total : partial ? Math.round((gross + tax) / 2) / 100 : 0;
      const inv = Number(insInv.run(
        `INV-B-${String(++invoiceSeq).padStart(7, '0')}`, subId, customer, k, ps, pe,
        gross / 100, tax / 100, total, amountPaid, st, ps, addDays(ps, 30)
      ).lastInsertRowid);
      nInvoices++;
      insInvLine.run(inv, productId, qty + 1, gross / 100, gross / 100, tax / 100, total);
      if (amountPaid > 0 && st !== 'Cancelled') { insPay.run(inv, amountPaid, pick(methods), addDays(ps, 3 + Math.floor(rand() * 20))); nPayments++; }
    }
  }
  db.exec("INSERT INTO sequences (name, value) VALUES ('invoice', " + invoiceSeq + ")");
  db.exec('COMMIT');
  db.exec('ANALYZE');
  const buildMs = performance.now() - t0;

  const count = (sql: string) => queryOne<{ n: number }>(sql)!.n;
  const dueNow = count(`SELECT COUNT(*) AS n FROM subscriptions WHERE status = 'Active' AND next_billing_date <= '${today}'`);
  const overdue = count(`SELECT COUNT(*) AS n FROM invoices WHERE status = 'Confirmed' AND amount_paid < total_amount AND due_date < '${today}'`);

  // ---- measure --------------------------------------------------------------------------------------
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const tokenFor = (id: number, role: 'admin' | 'staff' | 'customer') => generateToken({ id, email: '', role, full_name: '' });
  const staffToken = tokenFor(staffId, 'staff');
  const customerToken = tokenFor(customers[7], 'customer');
  const get = async (p: string, tok: string) => {
    const r = await fetch(base + p, { headers: { Authorization: `Bearer ${tok}` } });
    await r.arrayBuffer();
    if (r.status !== 200) throw new Error(`${p} -> ${r.status}`);
  };

  const someInvoice = queryOne<{ id: number }>("SELECT id FROM invoices WHERE status = 'Confirmed' LIMIT 1")!.id;
  const cases: Array<[string, string, string]> = [
    ['Finance dashboard summary', '/analytics/summary', staffToken],
    ['Dashboard with date range', `/analytics/summary?from=${addDays(today, -90)}&to=${today}`, staffToken],
    ['Subscriptions list, page 1', '/subscriptions?page=1&page_size=50', staffToken],
    ['Subscriptions, status=Active, page 1', '/subscriptions?status=Active&page=1', staffToken],
    ['Subscriptions, deep page (page 40)', '/subscriptions?page=40&page_size=50', staffToken],
    ['Subscriptions, search by number prefix', '/subscriptions?q=SUB-B-12', staffToken],
    ['Invoices list, page 1', '/billing/invoices?page=1&page_size=50', staffToken],
    ['Invoices, status=Confirmed', '/billing/invoices?status=Confirmed&page=1', staffToken],
    ['Invoices, overdue only', '/billing/invoices?overdue=true&page=1', staffToken],
    ['Invoices, deep page (page 200)', '/billing/invoices?page=200&page_size=50', staffToken],
    ['Invoices, date range', `/billing/invoices?from=${addDays(today, -30)}&to=${today}`, staffToken],
    ['Invoice detail with lines and payments', `/billing/invoices/${someInvoice}`, staffToken],
    ['Payments list, page 1', '/payments?page=1&page_size=50', staffToken],
    ['Payments, date range + method', `/payments?from=${addDays(today, -60)}&to=${today}&method=UPI`, staffToken],
    ['Customer portal: own subscriptions', '/subscriptions', customerToken],
    ['Customer portal: own invoices', '/billing/invoices', customerToken],
    ['Billing integrity report', '/billing/integrity', staffToken]
  ];

  const stats = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    return { median: s[Math.floor(s.length / 2)], p95: s[Math.min(s.length - 1, Math.ceil(s.length * 0.95) - 1)], max: s[s.length - 1] };
  };

  const rows: string[] = [];
  let worst = 0;
  for (const [name, p, tok] of cases) {
    await get(p, tok); // warm-up (statement cache, page cache)
    const times: number[] = [];
    for (let i = 0; i < RUNS; i++) {
      const t = performance.now();
      await get(p, tok);
      times.push(performance.now() - t);
    }
    const s = stats(times);
    worst = Math.max(worst, s.max);
    rows.push(`| ${name} | ${s.median.toFixed(1)} | ${s.p95.toFixed(1)} | ${s.max.toFixed(1)} |`);
  }

  // Billing day: dry run (everything computed, then rolled back), the real run, a repeat run, integrity.
  const tDry = performance.now();
  const dry = runBillingCycle(today, { dryRun: true });
  const dryMs = performance.now() - tDry;
  const tRun = performance.now();
  const run = runBillingCycle(today, { operatorUserId: adminId, autoConfirm: true });
  const runMs = performance.now() - tRun;
  const tAgain = performance.now();
  const again = runBillingCycle(today);
  const againMs = performance.now() - tAgain;
  const tInt = performance.now();
  const integrity = buildIntegrityReport();
  const intMs = performance.now() - tInt;
  if (!integrity.ok) console.error('INTEGRITY DETAILS', JSON.stringify(integrity.details, null, 1).slice(0, 2500));

  server.close();

  const plan = (sql: string, ...p: (string | number)[]) =>
    (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...p) as Array<{ detail: string }>).map(r => r.detail).join(' | ');
  const plans: Array<[string, string]> = [
    ['Due subscriptions', plan("SELECT id FROM subscriptions WHERE status = 'Active' AND next_billing_date <= ?", today)],
    ['Customer invoices', plan('SELECT id FROM invoices WHERE customer_id = ? ORDER BY id DESC LIMIT 50', customers[7])],
    ['Overdue invoices', plan("SELECT id FROM invoices WHERE status = 'Confirmed' AND amount_paid < total_amount AND due_date < ?", today)],
    ['Payments of an invoice', plan('SELECT id FROM payments WHERE invoice_id = ?', someInvoice)],
    ['Payments by date', plan('SELECT SUM(amount) FROM payments WHERE payment_date >= ? AND payment_date <= ?', addDays(today, -60), today)],
    ['Invoice period lookup', plan('SELECT id FROM invoices WHERE subscription_id = ? AND period_start = ?', 1, today)]
  ];

  const out: string[] = [];
  out.push(`### Benchmark results`);
  out.push('');
  out.push(`- Environment: Node ${process.version}, ${os.platform()} ${os.arch()}, ${os.cpus()[0]?.model.trim()} (${os.cpus().length} threads), SQLite via node:sqlite (WAL), file database`);
  out.push(`- Dataset (built in ${(buildMs / 1000).toFixed(1)} s): ${N_CUSTOMERS} customers, ${N_SUBS} subscriptions, ${nInvoices} invoices, ${nPayments} payments, ${dueNow} subscriptions due today, ${overdue} overdue invoices`);
  out.push(`- Method: real HTTP requests to the real Express app, ${RUNS} timed runs after 1 warm-up, milliseconds`);
  out.push('');
  out.push('| Endpoint | median | p95 | max |');
  out.push('|---|---:|---:|---:|');
  out.push(...rows);
  out.push('');
  out.push('| Billing operation | result | time |');
  out.push('|---|---|---:|');
  out.push(`| Dry run (compute, then roll back) | ${dry.invoicesCreated} invoices, ${dry.errors} errors | ${dryMs.toFixed(0)} ms |`);
  out.push(`| Real billing run | ${run.invoicesCreated} invoices created, ${run.errors} errors | ${runMs.toFixed(0)} ms |`);
  out.push(`| Second run, same date | ${again.invoicesCreated} invoices created | ${againMs.toFixed(0)} ms |`);
  out.push(`| Integrity report (${nInvoices + run.invoicesCreated} invoices) | duplicates ${integrity.duplicatePeriods}, missing ${integrity.missingPeriods}, ok=${integrity.ok} | ${intMs.toFixed(0)} ms |`);
  out.push('');
  out.push('Query plans:');
  for (const [n, d] of plans) out.push(`- ${n}: ${d}`);
  out.push('');
  out.push(`Slowest single request: ${worst.toFixed(1)} ms; SLA (< 2000 ms) ${worst < 2000 && runMs < 2000 ? 'met' : 'NOT met'}.`);
  console.log(out.join('\n'));
  fs.mkdirSync(path.join(__dirname, '../../docs'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, '../../docs/PERFORMANCE_RESULTS.md'), out.join('\n') + '\n');

  db.close();
  for (const ext of ['', '-wal', '-shm']) fs.rmSync(DB_FILE + ext, { force: true });
  process.exit(worst < 2000 ? 0 : 1);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

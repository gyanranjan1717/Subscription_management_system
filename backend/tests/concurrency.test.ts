import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import os from 'os';
import path from 'path';

// A real file database shared by several real OS processes (not :memory:, no shared JS state).
const DB_FILE = path.join(os.tmpdir(), `brightloop-conc-${process.pid}.sqlite`);
process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = DB_FILE;
for (const ext of ['', '-wal', '-shm']) fs.rmSync(DB_FILE + ext, { force: true });

const run = promisify(execFile);
const SUBS = 40;
const PERIODS = 3; // Jan, Feb, Mar

after(() => {
  for (const ext of ['', '-wal', '-shm']) fs.rmSync(DB_FILE + ext, { force: true });
});

test('concurrency: four billing processes started at once create each period exactly once', async () => {
  const { getDb, execute, queryOne } = await import('../src/db/database.js');
  const { buildIntegrityReport } = await import('../src/services/integrityService.js');
  getDb();

  const cust = Number(execute("INSERT INTO users (email, password_hash, full_name, role) VALUES ('c@x.com', 'x', 'c', 'customer')").lastInsertRowid);
  const product = Number(execute("INSERT INTO products (name, type, sales_price, cost_price) VALUES ('P', 'software', 10, 1)").lastInsertRowid);
  const plan = Number(execute("INSERT INTO plans (name, billing_interval, price) VALUES ('M', 'monthly', 0)").lastInsertRowid);
  const limited = Number(execute(
    `INSERT INTO discount_rules (code, description, discount_type, value, max_uses, applies_to)
     VALUES ('RACE', 'x', 'fixed', 1, 5, 'all')`
  ).lastInsertRowid);
  for (let i = 0; i < SUBS; i++) {
    const id = Number(execute(
      `INSERT INTO subscriptions (subscription_number, customer_id, plan_id, status, start_date, next_period_index, next_billing_date, discount_rule_id)
       VALUES (?, ?, ?, 'Active', '2026-01-01', 0, '2026-01-01', ?)`,
      [`S-${i}`, cust, plan, i < 20 ? limited : null]
    ).lastInsertRowid);
    execute('INSERT INTO subscription_lines (subscription_id, product_id, quantity, unit_price, line_amount) VALUES (?, ?, 1, 10, 10)', [id, product]);
  }

  const backendDir = path.join(__dirname, '..');
  const children = await Promise.all(
    [1, 2, 3, 4].map(() =>
      run(process.execPath, ['--import', 'tsx', 'tests/fixtures/bill-once.ts', '2026-03-15'], {
        cwd: backendDir,
        env: { ...process.env, DATABASE_PATH: DB_FILE, NODE_ENV: 'test' }
      })
    )
  );
  const results = children.map(c => JSON.parse(c.stdout.trim().split('\n').pop()!));

  assert.equal(results.reduce((s, r) => s + r.errors, 0), 0, 'no process hit an error');
  assert.equal(results.reduce((s, r) => s + r.created, 0), SUBS * PERIODS, 'together they created each period once');
  assert.equal(queryOne<{ n: number }>('SELECT COUNT(*) AS n FROM invoices')!.n, SUBS * PERIODS);
  assert.equal(
    queryOne<{ n: number }>('SELECT COUNT(DISTINCT subscription_id || period_start) AS n FROM invoices')!.n,
    SUBS * PERIODS
  );

  // The limited discount (5 uses) was handed out exactly 5 times across all processes.
  const rule = queryOne<{ current_uses: number }>("SELECT current_uses FROM discount_rules WHERE code = 'RACE'")!;
  assert.equal(rule.current_uses, 5);
  assert.equal(queryOne<{ n: number }>('SELECT COUNT(*) AS n FROM invoice_discounts')!.n, 5);

  const report = buildIntegrityReport();
  assert.equal(report.ok, true);
  getDb().close();
});

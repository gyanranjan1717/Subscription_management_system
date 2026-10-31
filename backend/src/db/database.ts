import { DatabaseSync, StatementSync } from 'node:sqlite';
import fs from 'fs';
import path from 'path';

/** Bumped whenever schema.sql changes incompatibly. `npm run seed` rebuilds the database. */
export const SCHEMA_VERSION = 2;

let dbInstance: DatabaseSync | null = null;

export function getDb(customPath?: string): DatabaseSync {
  if (dbInstance && !customPath) {
    return dbInstance;
  }

  const dbPath = customPath || process.env.DATABASE_PATH || path.join(__dirname, '../../data/brightloop.sqlite');

  if (dbPath !== ':memory:') {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const db = new DatabaseSync(dbPath);

  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  if (dbPath !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA synchronous = NORMAL;');
  }

  const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
  const hasUsers = db.prepare("SELECT 1 AS x FROM sqlite_master WHERE type='table' AND name='users'").get();
  if (hasUsers && row.user_version !== SCHEMA_VERSION) {
    throw new Error(
      `Database schema is outdated (found v${row.user_version}, need v${SCHEMA_VERSION}). Run "npm run seed" to rebuild it.`
    );
  }

  applySchema(db);
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION};`);

  if (!customPath) {
    dbInstance = db;
  }
  return db;
}

export function applySchema(db: DatabaseSync): void {
  const schemaPath = path.join(__dirname, 'schema.sql');
  db.exec(fs.readFileSync(schemaPath, 'utf8'));
}

/** Drops every table so the schema can be recreated from scratch (seed / benchmark only). */
export function dropAllTables(db: DatabaseSync): void {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all() as Array<{ name: string }>;
  db.exec('PRAGMA foreign_keys = OFF;');
  for (const t of tables) {
    db.exec(`DROP TABLE IF EXISTS "${t.name}";`);
  }
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA user_version = 0;');
}

/** Opens the configured database file raw and drops every table (used by `npm run seed` only). */
export function resetDatabaseFile(customPath?: string): void {
  const dbPath = customPath || process.env.DATABASE_PATH || path.join(__dirname, '../../data/brightloop.sqlite');
  if (dbPath === ':memory:' || !fs.existsSync(dbPath)) return;
  const raw = new DatabaseSync(dbPath);
  dropAllTables(raw);
  raw.close();
}

type Param = string | number | bigint | null;

/**
 * Prepared statements are compiled once per SQL text and reused (the hot paths run the same few
 * statements thousands of times). SQLite re-prepares them transparently if the schema changes.
 */
const statements = new Map<string, StatementSync>();
const MAX_CACHED_STATEMENTS = 500;

let statementExecutions = 0;
/** Number of statements executed so far (tests use it to prove list endpoints do not query per row). */
export function getStatementCount(): number {
  return statementExecutions;
}

function prepared(sql: string): StatementSync {
  const db = getDb();
  statementExecutions++;
  let stmt = statements.get(sql);
  if (!stmt) {
    if (statements.size >= MAX_CACHED_STATEMENTS) statements.clear();
    stmt = db.prepare(sql);
    statements.set(sql, stmt);
  }
  return stmt;
}

export function queryAll<T = any>(sql: string, params: Param[] = []): T[] {
  return prepared(sql).all(...params) as T[];
}

export function queryOne<T = any>(sql: string, params: Param[] = []): T | null {
  const row = prepared(sql).get(...params);
  return (row as T | undefined) ?? null;
}

export function execute(sql: string, params: Param[] = []): { changes: number; lastInsertRowid: number | bigint } {
  const result = prepared(sql).run(...params);
  return { changes: Number(result.changes), lastInsertRowid: result.lastInsertRowid };
}

let txDepth = 0;
let savepointSeq = 0;

/**
 * Runs `fn` atomically. The outermost call opens `BEGIN IMMEDIATE` so the write lock is taken up
 * front (no read-then-write races between processes); nested calls become SAVEPOINTs, so a failing
 * inner unit of work rolls back alone while the outer transaction survives.
 */
export function runTransaction<T>(fn: () => T): T {
  const db = getDb();
  if (txDepth === 0) {
    db.exec('BEGIN IMMEDIATE');
    txDepth++;
    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    } finally {
      txDepth--;
    }
  }

  const name = `sp_${++savepointSeq}`;
  db.exec(`SAVEPOINT ${name}`);
  txDepth++;
  try {
    const result = fn();
    db.exec(`RELEASE ${name}`);
    return result;
  } catch (err) {
    db.exec(`ROLLBACK TO ${name}`);
    db.exec(`RELEASE ${name}`);
    throw err;
  } finally {
    txDepth--;
  }
}

/** Atomically increments and returns a named counter (gap-free under the write lock). */
export function nextSequence(name: string): number {
  return runTransaction(() => {
    execute(
      'INSERT INTO sequences (name, value) VALUES (?, 1) ON CONFLICT(name) DO UPDATE SET value = value + 1',
      [name]
    );
    return queryOne<{ value: number }>('SELECT value FROM sequences WHERE name = ?', [name])!.value;
  });
}

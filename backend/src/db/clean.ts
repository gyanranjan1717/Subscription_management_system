import { getDb, resetDatabaseFile, applySchema } from './database.js';

/**
 * Resets the SQLite database to a completely blank, clean-slate state.
 * All pre-seeded and hardcoded accounts, staff, products, plans, subscriptions,
 * invoices, and outbox logs are removed.
 *
 * After running this, register your initial Administrator account at http://localhost:3000
 * using the Admin Master Key configured in your .env (BrightloopAdminKey#2026).
 */
export function cleanDatabase(): void {
  console.log('--- Wiping all pre-seeded and hardcoded records from Brightloop database ---');
  resetDatabaseFile();
  const db = getDb();
  applySchema(db);
  db.exec('PRAGMA user_version = 3;');
  db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  console.log('--- Clean slate established: 0 users, 0 staff, 0 products, 0 plans, 0 subscriptions, 0 invoices. ---');
}

cleanDatabase();

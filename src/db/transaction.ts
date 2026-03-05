import type { Database, DbClient } from './index';

/**
 * Run multiple DB operations atomically.
 *
 * In production (D1): uses a real async transaction.
 * In local/test (better-sqlite3): runs operations sequentially on the db
 * instance — better-sqlite3 rejects async transaction callbacks, but
 * local SQLite doesn't need atomicity guarantees.
 */
export async function withTransaction(
  db: Database,
  fn: (tx: DbClient) => Promise<void>,
): Promise<void> {
  // better-sqlite3 drizzle instances have a synchronous $client;
  // D1 drizzle instances do not. Use this to pick the right path.
  if ('$client' in db && typeof (db.$client as any)?.pragma === 'function') {
    await fn(db as DbClient);
    return;
  }
  await (db as any).transaction(fn);
}

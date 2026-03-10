import type { Database, DbClient } from './index';

/**
 * Run multiple write statements atomically.
 *
 * Callback must return query builders (do not await inside callback).
 * Local/test: executes queries sequentially.
 * D1: executes with db.batch(...).
 */
export async function withBatch(
  db: Database,
  fn: (tx: DbClient) => unknown[] | Promise<unknown[]>,
): Promise<void> {
  const statements = await fn(db as DbClient);

  if ('$client' in db && typeof ((db as unknown as Record<string, unknown>).$client as Record<string, unknown>)?.pragma === 'function') {
    for (const statement of statements) {
      await statement;
    }
    return;
  }

  await (db as unknown as { batch(s: unknown[]): Promise<void> }).batch(statements);
}

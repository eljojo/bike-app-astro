import { drizzle } from 'drizzle-orm/d1';
import * as schema from './schema';

export function getDb(d1: D1Database) {
  return drizzle(d1, { schema });
}

export { createLocalDb } from './local';

export type Database = ReturnType<typeof getDb>;

/** Type that accepts both a Database and a transaction — use for functions that can run inside a transaction. */
export type DbClient = Database | (Parameters<Parameters<Database['transaction']>[0]>[0]);

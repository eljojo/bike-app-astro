import { env } from './env';
import { getDb as getD1Db, type Database } from '../db';

/**
 * Get the database instance.
 * In local mode, env.DB is already a drizzle instance (better-sqlite3).
 * In production, it's a D1Database that needs wrapping with drizzle.
 */
export function db(): Database {
  if (process.env.RUNTIME === 'local') {
    return env.DB as Database;
  }
  return getD1Db(env.DB);
}

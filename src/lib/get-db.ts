import { env, openLocalDb, localDbPath } from './env';
import { getDb as getD1Db, type Database } from '../db';

/**
 * Get the database instance.
 *
 * In local mode, creates a FRESH better-sqlite3 connection per call instead
 * of returning the singleton created at server startup. This is necessary
 * because all admin E2E tests share a single `astro preview` server (since
 * 66d0b3e unified the test fixtures), but Playwright seeds sessions by
 * writing directly to the SQLite file from separate worker processes.
 * A long-lived singleton better-sqlite3 connection in WAL mode can't see
 * those cross-process writes — the server's connection returns zero rows
 * even though a fresh connection on the same file sees the data.
 *
 * The bug is latent: it only triggers when Playwright recycles a worker
 * (e.g., after a screenshot mismatch), causing seedSession() to run from
 * a new PID. As long as all tests pass on the first try, the singleton
 * works fine — which is why it went undetected until screenshot baselines
 * drifted.
 *
 * Each connection is lightweight (no schema init — tables already exist)
 * and is closed when garbage-collected by better-sqlite3's C++ destructor.
 *
 * In production, env.DB is a D1Database that gets wrapped with drizzle.
 */
export function db(): Database {
  if (process.env.RUNTIME === 'local' && openLocalDb && localDbPath) {
    return openLocalDb(localDbPath) as Database;
  }
  return getD1Db(env.DB as D1Database);
}

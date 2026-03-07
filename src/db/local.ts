import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';
import { initSchema } from './init-schema';
import fs from 'node:fs';
import path from 'node:path';

export function createLocalDb(dbPath: string) {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  initSchema(sqlite);

  return drizzle(sqlite, { schema });
}

/**
 * Open a connection to an existing local DB (no schema init).
 *
 * Used by get-db.ts to create a fresh connection per request. See the
 * comment in get-db.ts for the full explanation of why a singleton
 * connection doesn't work when Playwright workers write to the same
 * SQLite file from separate processes.
 */
export function openLocalDb(dbPath: string) {
  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  return drizzle(sqlite, { schema });
}

export type LocalDatabase = ReturnType<typeof createLocalDb>;

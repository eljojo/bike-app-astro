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

export type LocalDatabase = ReturnType<typeof createLocalDb>;

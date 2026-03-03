import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';
import fs from 'node:fs';
import path from 'node:path';

export function createLocalDb(dbPath: string) {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id text PRIMARY KEY NOT NULL,
      email text NOT NULL UNIQUE,
      display_name text NOT NULL,
      role text DEFAULT 'editor' NOT NULL,
      created_at text NOT NULL
    );
    CREATE TABLE IF NOT EXISTS credentials (
      id text PRIMARY KEY NOT NULL,
      user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      credential_id text NOT NULL UNIQUE,
      public_key blob NOT NULL,
      counter integer DEFAULT 0 NOT NULL,
      transports text,
      created_at text NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id text PRIMARY KEY NOT NULL,
      user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token text NOT NULL UNIQUE,
      expires_at text NOT NULL,
      created_at text NOT NULL
    );
    CREATE TABLE IF NOT EXISTS invite_codes (
      id text PRIMARY KEY NOT NULL,
      code text NOT NULL UNIQUE,
      created_by text NOT NULL REFERENCES users(id),
      used_by text REFERENCES users(id),
      expires_at text,
      created_at text NOT NULL
    );
    CREATE TABLE IF NOT EXISTS route_edits (
      slug text PRIMARY KEY NOT NULL,
      data text NOT NULL,
      github_sha text NOT NULL,
      updated_at text NOT NULL
    );
    CREATE TABLE IF NOT EXISTS event_edits (
      id text PRIMARY KEY NOT NULL,
      data text NOT NULL,
      github_sha text NOT NULL,
      updated_at text NOT NULL
    );
  `);

  return drizzle(sqlite, { schema });
}

export type LocalDatabase = ReturnType<typeof createLocalDb>;

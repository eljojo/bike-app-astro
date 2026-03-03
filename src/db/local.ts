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
      email text UNIQUE,
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
    CREATE TABLE IF NOT EXISTS drafts (
      id text PRIMARY KEY NOT NULL,
      user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content_type text NOT NULL,
      content_slug text NOT NULL,
      branch_name text NOT NULL,
      pr_number integer,
      created_at text NOT NULL,
      updated_at text NOT NULL
    );
    CREATE TABLE IF NOT EXISTS content_edits (
      content_type text NOT NULL,
      content_slug text NOT NULL,
      data text NOT NULL,
      github_sha text NOT NULL,
      updated_at text NOT NULL,
      PRIMARY KEY (content_type, content_slug)
    );
  `);

  return drizzle(sqlite, { schema });
}

export type LocalDatabase = ReturnType<typeof createLocalDb>;

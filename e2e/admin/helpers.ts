/**
 * Shared test helpers for admin E2E specs.
 *
 * Provides session seeding/cleanup against the local SQLite DB
 * used by RUNTIME=local admin tests.
 */
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DB_PATH } from './fixture.ts';

function ensureSchema(db: InstanceType<typeof Database>) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id text PRIMARY KEY NOT NULL,
      email text UNIQUE,
      display_name text NOT NULL,
      role text DEFAULT 'editor' NOT NULL,
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
  `);
}

interface SeedOptions {
  role?: 'admin' | 'editor' | 'guest';
  displayName?: string;
  email?: string | null;
}

/** Insert a user + session into the local DB and return the session token. */
export function seedSession(opts: SeedOptions = {}): string {
  const { role = 'admin', displayName = 'Playwright Test', email = 'playwright@test.local' } = opts;
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const db = new Database(DB_PATH);
  ensureSchema(db);
  const userId = crypto.randomUUID();
  const token = crypto.randomBytes(32).toString('hex');
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  db.prepare(
    'INSERT OR REPLACE INTO users (id, email, display_name, role, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(userId, email, displayName, role, now);

  db.prepare(
    'INSERT INTO sessions (id, user_id, token, expires_at, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(crypto.randomUUID(), userId, token, expiresAt, now);

  // Clear stale content edits from previous runs so conflict detection doesn't fire
  try {
    db.prepare('DELETE FROM content_edits').run();
  } catch {
    // Table may not exist yet on first run
  }

  db.close();
  return token;
}

/** Remove the user and session created by seedSession. */
export function cleanupSession(token: string) {
  if (!fs.existsSync(DB_PATH)) return;
  const db = new Database(DB_PATH);
  const hasTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'").get();
  if (!hasTable) { db.close(); return; }
  const session = db.prepare('SELECT user_id FROM sessions WHERE token = ?').get(token) as any;
  if (session) {
    try { db.prepare('DELETE FROM drafts WHERE user_id = ?').run(session.user_id); } catch {}
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    db.prepare('DELETE FROM users WHERE id = ?').run(session.user_id);
  }
  db.close();
}

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
import { DB_PATH } from './fixture-setup.ts';
import { initSchema } from '../../src/db/init-schema';

interface SeedOptions {
  role?: 'admin' | 'editor' | 'guest';
  username?: string;
  email?: string | null;
}

/** Insert a user + session into the local DB and return the session token. */
export function seedSession(opts: SeedOptions = {}): string {
  const { role = 'admin', username = 'Playwright Test', email = 'playwright@test.local' } = opts;
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const db = new Database(DB_PATH);
  initSchema(db);
  const userId = crypto.randomUUID();
  const token = crypto.randomBytes(32).toString('hex');
  // Fixed future dates for deterministic tests. The server checks expiry against
  // Date.now(), so these must be far enough in the future to remain valid.
  const now = '2099-01-01T00:00:00.000Z';
  const expiresAt = '2099-01-02T00:00:00.000Z';

  db.prepare(
    'INSERT OR REPLACE INTO users (id, email, username, role, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(userId, email, username, role, now);

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

/** Set session cookie on a Playwright page. */
export async function loginAs(page: import('@playwright/test').Page, token: string) {
  await page.context().addCookies([{
    name: 'session_token', value: token,
    domain: 'localhost', path: '/', httpOnly: true, secure: false,
  }]);
}

/** Remove the user and session created by seedSession. */
export function cleanupSession(token: string) {
  if (!fs.existsSync(DB_PATH)) return;
  const db = new Database(DB_PATH);
  const hasTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'").get();
  if (!hasTable) { db.close(); return; }
  const session = db.prepare('SELECT user_id FROM sessions WHERE token = ?').get(token) as any;
  if (session) {
    try { db.prepare('DELETE FROM banned_ips WHERE user_id = ?').run(session.user_id); } catch {}
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    db.prepare('DELETE FROM users WHERE id = ?').run(session.user_id);
  }
  db.close();
}

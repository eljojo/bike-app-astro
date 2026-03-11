/**
 * Blog test helpers — mirrors admin helpers but uses blog DB path.
 */
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DB_PATH } from './fixture-setup.ts';
import { initSchema } from '../../src/db/init-schema';

function openDb(): InstanceType<typeof Database> {
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  return db;
}

export function seedSession(opts: { role?: string; username?: string } = {}): string {
  const suffix = crypto.randomUUID().slice(0, 8);
  const { role = 'admin', username = `Test ${suffix}` } = opts;
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const db = openDb();
  initSchema(db);
  const userId = crypto.randomUUID();
  const token = crypto.randomBytes(32).toString('hex');
  const now = '2099-01-01T00:00:00.000Z';
  const expiresAt = '2099-01-02T00:00:00.000Z';

  db.prepare(
    'INSERT OR REPLACE INTO users (id, email, username, role, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(userId, `test-${suffix}@test.local`, username, role, now);

  db.prepare(
    'INSERT INTO sessions (id, user_id, token, expires_at, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(crypto.randomUUID(), userId, token, expiresAt, now);

  db.close();
  return token;
}

export async function loginAs(page: import('@playwright/test').Page, token: string) {
  await page.context().addCookies([{
    name: 'session_token', value: token,
    domain: 'localhost', path: '/', httpOnly: true, secure: false,
  }]);
}

export function cleanupSession(token: string) {
  if (!fs.existsSync(DB_PATH)) return;
  const db = openDb();
  const hasTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'").get();
  if (!hasTable) { db.close(); return; }
  const session = db.prepare('SELECT user_id FROM sessions WHERE token = ?').get(token) as any;
  if (session) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    db.prepare('DELETE FROM users WHERE id = ?').run(session.user_id);
  }
  db.close();
}

export function clearContentEdits(contentType: string, slug: string) {
  if (!fs.existsSync(DB_PATH)) return;
  const db = openDb();
  try {
    db.prepare('DELETE FROM content_edits WHERE content_type = ? AND content_slug = ?').run(contentType, slug);
  } catch {}
  db.close();
}

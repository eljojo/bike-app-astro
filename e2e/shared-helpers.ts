/**
 * Shared E2E test helpers.
 *
 * Core session/DB functions used by admin, blog, and club test suites.
 * Each suite provides its own DB_PATH via thin wrappers.
 */
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { initSchema } from '../src/db/init-schema';

/** Open a DB connection with WAL mode and busy timeout for concurrent access. */
function openDb(dbPath: string): InstanceType<typeof Database> {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  return db;
}

export interface SeedOptions {
  role?: 'admin' | 'editor' | 'guest';
  username?: string;
  email?: string | null;
}

/** Insert a user + session into the local DB and return the session token. */
export function seedSession(dbPath: string, opts: SeedOptions = {}): string {
  const suffix = crypto.randomUUID().slice(0, 8);
  const {
    role = 'admin',
    username = `Test ${suffix}`,
    email = `test-${suffix}@test.local`,
  } = opts;
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const db = openDb(dbPath);
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
export function cleanupSession(dbPath: string, token: string) {
  if (!fs.existsSync(dbPath)) return;
  const db = openDb(dbPath);
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

/** Clear content_edits cache for a content item so retries see clean state. */
export function clearContentEdits(dbPath: string, contentType: string, slug: string) {
  if (!fs.existsSync(dbPath)) return;
  const db = openDb(dbPath);
  try {
    db.prepare('DELETE FROM content_edits WHERE content_type = ? AND content_slug = ?').run(contentType, slug);
  } catch {}
  db.close();
}

/** Read a content_edits cache entry. Returns null if not found. */
export function getContentEdit(
  dbPath: string,
  contentType: string,
  slug: string,
): { data: string; githubSha: string; updatedAt: string } | null {
  if (!fs.existsSync(dbPath)) return null;
  const db = openDb(dbPath);
  try {
    const row = db.prepare(
      'SELECT data, github_sha, updated_at FROM content_edits WHERE content_type = ? AND content_slug = ?'
    ).get(contentType, slug) as { data: string; github_sha: string; updated_at: string } | undefined;
    if (!row) return null;
    return { data: row.data, githubSha: row.github_sha, updatedAt: row.updated_at };
  } catch {
    return null;
  } finally {
    db.close();
  }
}

/** Seed a content_edits cache entry (e.g. to simulate a pending event). */
export function seedContentEdit(
  dbPath: string,
  contentType: string,
  slug: string,
  data: string,
  githubSha = 'test-sha',
) {
  const db = openDb(dbPath);
  try {
    db.prepare(
      `INSERT OR REPLACE INTO content_edits (city, content_type, content_slug, data, github_sha, updated_at)
       VALUES ('demo', ?, ?, ?, ?, datetime('now'))`
    ).run(contentType, slug, data, githubSha);
  } finally {
    db.close();
  }
}

/** Get the latest email token for a user (by userId or email). */
export function getEmailToken(
  dbPath: string,
  opts: { userId?: string; email?: string },
): { token: string; userId: string; email: string; expiresAt: string } | null {
  if (!fs.existsSync(dbPath)) return null;
  const db = openDb(dbPath);
  try {
    const where = opts.userId ? 'user_id = ?' : 'email = ?';
    const param = opts.userId || opts.email;
    const row = db.prepare(
      `SELECT token, user_id, email, expires_at FROM email_tokens
       WHERE ${where} AND used_at IS NULL
       ORDER BY created_at DESC LIMIT 1`
    ).get(param) as { token: string; user_id: string; email: string; expires_at: string } | undefined;
    if (!row) return null;
    return { token: row.token, userId: row.user_id, email: row.email, expiresAt: row.expires_at };
  } catch {
    return null;
  } finally {
    db.close();
  }
}

/** Get user by ID from the DB. */
export function getUser(
  dbPath: string,
  userId: string,
): { id: string; email: string | null; username: string; role: string; emailVerified: number } | null {
  if (!fs.existsSync(dbPath)) return null;
  const db = openDb(dbPath);
  try {
    const row = db.prepare(
      'SELECT id, email, username, role, email_verified FROM users WHERE id = ?'
    ).get(userId) as { id: string; email: string | null; username: string; role: string; email_verified: number } | undefined;
    if (!row) return null;
    return { id: row.id, email: row.email, username: row.username, role: row.role, emailVerified: row.email_verified };
  } catch {
    return null;
  } finally {
    db.close();
  }
}

// Staging origin used to proxy tile requests in E2E — CI has no Thunderforest
// API key, so we intercept /api/tiles/* and forward to staging which has one.
const TILE_PROXY_ORIGIN = 'https://new.ottawabybike.ca';

/**
 * Intercept tile/font requests and proxy them through staging.
 * Playwright's route() intercepts at the network level, bypassing CORS.
 */
export async function proxyTiles(page: import('@playwright/test').Page) {
  await page.route('**/api/tiles/**', async (route) => {
    const url = new URL(route.request().url());
    const upstream = `${TILE_PROXY_ORIGIN}${url.pathname}`;
    try {
      const res = await fetch(upstream);
      const body = Buffer.from(await res.arrayBuffer());
      await route.fulfill({
        status: res.status,
        headers: { 'Content-Type': res.headers.get('Content-Type') || 'application/octet-stream' },
        body,
      });
    } catch {
      await route.abort();
    }
  });
}

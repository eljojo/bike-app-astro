/**
 * Shared test helpers for admin E2E specs.
 *
 * Provides session seeding/cleanup against the local SQLite DB
 * used by RUNTIME=local admin tests.
 *
 * All DB connections use WAL mode and a busy timeout to handle
 * concurrent access from parallel Playwright workers.
 */
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { DB_PATH, FIXTURE_DIR } from './fixture-setup.ts';
import { initSchema } from '../../src/db/init-schema';

/** Open a DB connection with WAL mode and busy timeout for concurrent access. */
function openDb(): InstanceType<typeof Database> {
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  return db;
}

interface SeedOptions {
  role?: 'admin' | 'editor' | 'guest';
  username?: string;
  email?: string | null;
}

/** Insert a user + session into the local DB and return the session token. */
export function seedSession(opts: SeedOptions = {}): string {
  const suffix = crypto.randomUUID().slice(0, 8);
  const {
    role = 'admin',
    username = `Playwright Test ${suffix}`,
    email = `playwright-${suffix}@test.local`,
  } = opts;
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const db = openDb();
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

/** Set session cookie on a Playwright page. */
export async function loginAs(page: import('@playwright/test').Page, token: string) {
  await page.context().addCookies([{
    name: 'session_token', value: token,
    domain: 'localhost', path: '/', httpOnly: true, secure: false,
  }]);
}

/** Clear content_edits cache for a route/event so retries see clean state. */
export function clearContentEdits(contentType: string, slug: string) {
  if (!fs.existsSync(DB_PATH)) return;
  const db = openDb();
  try {
    db.prepare('DELETE FROM content_edits WHERE content_type = ? AND content_slug = ?').run(contentType, slug);
  } catch {}
  db.close();
}

/** Remove the user and session created by seedSession. */
export function cleanupSession(token: string) {
  if (!fs.existsSync(DB_PATH)) return;
  const db = openDb();
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

/** Get the root commit SHA of the fixture repo (the "initial fixture" commit). */
let rootCommit: string | undefined;
function getFixtureRootCommit(): string {
  if (!rootCommit) {
    rootCommit = execSync('git rev-list --max-parents=0 HEAD', {
      cwd: FIXTURE_DIR, encoding: 'utf-8',
    }).trim();
  }
  return rootCommit;
}

/**
 * Remove files/dirs created by a previous test attempt so retries start clean.
 * Only touches the filesystem — no git operations needed since the server's
 * LocalGitService reads from disk, not from git objects.
 */
export function cleanupCreatedFiles(paths: string[]) {
  for (const relPath of paths) {
    const fullPath = path.join(FIXTURE_DIR, relPath);
    if (fs.existsSync(fullPath)) {
      fs.rmSync(fullPath, { recursive: true });
    }
  }
}

/**
 * Restore fixture files to their initial state from the root commit.
 *
 * Uses `git show` (read-only, no index lock needed) to read the original
 * content and writes it back to disk via fs. This avoids git index lock
 * contention with concurrent workers and the server's git mutex.
 *
 * Works because LocalGitService.readFile() reads from the filesystem,
 * not from git objects — so restoring the file content on disk is sufficient.
 */
export function restoreFixtureFiles(paths: string[]) {
  const root = getFixtureRootCommit();
  for (const relPath of paths) {
    try {
      const content = execSync(`git show ${root}:"${relPath}"`, {
        cwd: FIXTURE_DIR, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
      });
      fs.writeFileSync(path.join(FIXTURE_DIR, relPath), content, 'utf-8');
    } catch {
      // File might not exist in root commit — nothing to restore.
    }
  }
}

/**
 * Delete a file if it exists. No git operations — the server reads
 * from disk, so removing the file is sufficient.
 */
export function deleteFixtureFile(relPath: string) {
  const fullPath = path.join(FIXTURE_DIR, relPath);
  if (fs.existsSync(fullPath)) {
    try { fs.unlinkSync(fullPath); } catch {}
  }
}

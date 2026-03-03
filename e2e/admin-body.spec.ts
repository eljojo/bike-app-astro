import { test, expect } from '@playwright/test';
import Database from 'better-sqlite3';
import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, '..', '.data', 'local.db');

function seedTestSession(): string {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const db = new Database(DB_PATH);
  const userId = crypto.randomUUID();
  const token = crypto.randomBytes(32).toString('hex');
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  db.prepare(
    'INSERT OR REPLACE INTO users (id, email, display_name, role, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(userId, 'playwright@test.local', 'Playwright Test', 'admin', now);

  db.prepare(
    'INSERT INTO sessions (id, user_id, token, expires_at, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(crypto.randomUUID(), userId, token, expiresAt, now);

  db.close();
  return token;
}

function cleanupTestSession(token: string) {
  if (!fs.existsSync(DB_PATH)) return;
  const db = new Database(DB_PATH);
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  db.prepare("DELETE FROM users WHERE email = 'playwright@test.local'").run();
  db.close();
}

test.describe('Admin Route Editor', () => {
  let token: string;

  test.beforeAll(() => {
    token = seedTestSession();
  });

  test.afterAll(() => {
    cleanupTestSession(token);
  });

  // Regression test: Preact hydration removes textarea text children without
  // setting the value property, causing the body field to appear empty.
  // Fixed by adding a useEffect in RouteEditor to re-apply the value on mount.
  //
  // TODO: investigate whether this is a Preact bug worth reporting upstream.
  // The root cause is in preact/src/diff/index.js — the `value` prop is
  // guarded by `if (!isHydrating)`, so it's never applied during hydrate().
  // Child diffing then removes the SSR text nodes, clearing the textarea.
  // Consider opening a PR against preactjs/preact.
  test('body textarea retains content after Preact hydration', async ({ page }) => {
    await page.context().addCookies([
      {
        name: 'session_token',
        value: token,
        domain: 'localhost',
        path: '/',
        httpOnly: true,
        secure: false,
      },
    ]);

    await page.goto('/admin/routes/carp');
    await page.waitForLoadState('networkidle');

    const textarea = page.locator('#route-body');
    await expect(textarea).toBeVisible({ timeout: 10000 });

    // Wait for Preact hydration to complete
    await page.waitForTimeout(2000);

    const value = await textarea.inputValue();
    expect(value).toContain('Carp is a rural community');
    expect(value.length).toBeGreaterThan(50);
  });

});

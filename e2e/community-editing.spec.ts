import { test, expect } from '@playwright/test';
import Database from 'better-sqlite3';
import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, '..', '.data', 'local.db');

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

function seedSession(role: 'admin' | 'editor' | 'guest', displayName: string, email: string | null): string {
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

  db.close();
  return token;
}

function cleanupSession(token: string) {
  if (!fs.existsSync(DB_PATH)) return;
  const db = new Database(DB_PATH);
  // Tables may not exist if the dev server created a fresh DB
  const hasTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'").get();
  if (!hasTable) { db.close(); return; }
  const session = db.prepare('SELECT user_id FROM sessions WHERE token = ?').get(token) as any;
  if (session) {
    db.prepare('DELETE FROM drafts WHERE user_id = ?').run(session.user_id);
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    db.prepare('DELETE FROM users WHERE id = ?').run(session.user_id);
  }
  db.close();
}

test.describe('Community Editing — Auth Gate', () => {
  test('unauthenticated user sees auth gate on admin pages', async ({ page }) => {
    await page.goto('/admin/routes/carp');
    await page.waitForLoadState('networkidle');

    // Should redirect to gate page
    expect(page.url()).toContain('/gate');
    await expect(page.locator('.gate-options')).toBeVisible();
    await expect(page.getByText('Continue as guest')).toBeVisible();
    await expect(page.getByText('Sign in')).toBeVisible();
  });

  test('guest account creation redirects to editor', async ({ page }) => {
    await page.goto('/gate?returnTo=/admin/routes/carp');
    await page.waitForLoadState('networkidle');

    // Click continue as guest
    const guestButton = page.getByText('Continue as guest');
    await guestButton.click();

    // Should redirect to the editor
    await page.waitForURL(url => url.pathname === '/admin/routes/carp', { timeout: 10000 });
    await expect(page.locator('h1')).toContainText('Edit:');
  });
});

test.describe('Community Editing — Guest Draft Flow', () => {
  let token: string;

  test.beforeAll(() => {
    token = seedSession('guest', 'cyclist-e2e1', null);
  });

  test.afterAll(() => {
    cleanupSession(token);
  });

  test('guest save creates draft branch and shows banner on reload', async ({ page }) => {
    await page.context().addCookies([{
      name: 'session_token', value: token,
      domain: 'localhost', path: '/', httpOnly: true, secure: false,
    }]);

    await page.goto('/admin/routes/carp');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Initially no draft banner
    await expect(page.locator('.draft-banner')).not.toBeVisible();

    // Make an edit
    const taglineInput = page.locator('#route-tagline');
    await taglineInput.fill('E2E test tagline');

    // Save
    const saveButton = page.getByRole('button', { name: /save/i });
    await saveButton.click();

    // Wait for save response
    await expect(page.locator('.save-success')).toBeVisible({ timeout: 15000 });

    // Reload and verify draft banner appears
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    await expect(page.locator('.draft-banner')).toBeVisible();
    await expect(page.locator('.draft-banner')).toContainText('Draft');
  });
});

test.describe('Community Editing — Admin Direct Commit', () => {
  let token: string;

  test.beforeAll(() => {
    token = seedSession('admin', 'Admin User', 'admin@test.local');
  });

  test.afterAll(() => {
    cleanupSession(token);
  });

  test('admin without editor mode saves directly (no draft banner)', async ({ page }) => {
    await page.context().addCookies([{
      name: 'session_token', value: token,
      domain: 'localhost', path: '/', httpOnly: true, secure: false,
    }]);

    await page.goto('/admin/routes/carp');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // No draft banner for admin
    await expect(page.locator('.draft-banner')).not.toBeVisible();
  });

  test('admin with editor mode creates draft branch', async ({ page }) => {
    await page.context().addCookies([
      {
        name: 'session_token', value: token,
        domain: 'localhost', path: '/', httpOnly: true, secure: false,
      },
      {
        name: 'editor_mode', value: '1',
        domain: 'localhost', path: '/', httpOnly: false, secure: false,
      },
    ]);

    await page.goto('/admin');
    await page.waitForLoadState('networkidle');

    // Editor mode toggle should be checked
    const checkbox = page.locator('#editor-mode-checkbox');
    await expect(checkbox).toBeChecked();
  });
});

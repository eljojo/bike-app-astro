import { test, expect } from '@playwright/test';
import path from 'node:path';
import { seedSession, cleanupSession, loginAs, proxyTiles } from './helpers.ts';
import { FIXTURE_DIR } from './fixture-setup.ts';

// Admin pages include Preact islands and dynamic user info (e.g. gravatar)
// that can cause minor rendering differences between runs.
const screenshotOpts = { fullPage: true, maxDiffPixelRatio: 0.04 };

// Fixed date for deterministic screenshots (matches fixture-setup.ts and helpers.ts).
const FIXED_DATE = new Date('2025-06-15T16:00:00.000Z');

test.describe('Admin Screenshots — Editor Pages', () => {
  let token: string;

  test.beforeAll(() => {
    token = seedSession({ role: 'editor', username: 'Screenshot Editor', email: 'editor@test.local' });
  });

  test.afterAll(() => {
    cleanupSession(token);
  });

  test.beforeEach(async ({ page }) => {
    await page.clock.install({ time: FIXED_DATE });
    await loginAs(page, token);
    await proxyTiles(page);
  });

  test('dashboard', async ({ page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    await expect(page).toHaveScreenshot('admin-dashboard.png', screenshotOpts);
  });

  test('route list', async ({ page }) => {
    await page.goto('/admin/routes');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    await expect(page).toHaveScreenshot('admin-route-list.png', screenshotOpts);
  });

  test('route editor', async ({ page }) => {
    await page.goto('/admin/routes/carp');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    await expect(page).toHaveScreenshot('admin-route-editor.png', screenshotOpts);
  });

  test('route creation', async ({ page }) => {
    await page.goto('/admin/routes/new');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    await expect(page).toHaveScreenshot('admin-route-creation.png', screenshotOpts);
  });

  test('route creation preview', async ({ page }) => {
    await page.goto('/admin/routes/new');
    await page.waitForLoadState('networkidle');

    // Upload a GPX file to trigger the preview
    const gpxInput = page.locator('input[type="file"][accept=".gpx"]');
    const gpxPath = path.join(FIXTURE_DIR, 'demo/routes/carp/main.gpx');
    await gpxInput.setInputFiles(gpxPath);

    // Wait for map and preview to render
    await expect(page.locator('.route-preview-map')).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(2000);
    await expect(page).toHaveScreenshot('admin-route-creation-preview.png', screenshotOpts);
  });

  test('event list', async ({ page }) => {
    await page.goto('/admin/events');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    await expect(page).toHaveScreenshot('admin-event-list.png', screenshotOpts);
  });

  test('event editor', async ({ page }) => {
    await page.goto('/admin/events/2099/bike-fest');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    await expect(page).toHaveScreenshot('admin-event-editor.png', screenshotOpts);
  });

  test('event creation', async ({ page }) => {
    await page.goto('/admin/events/new');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    await expect(page).toHaveScreenshot('admin-event-creation.png', screenshotOpts);
  });

  test('edit history', async ({ page }) => {
    await page.goto('/admin/history');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    await expect(page).toHaveScreenshot('admin-edit-history.png', screenshotOpts);
  });

  test('settings', async ({ page }) => {
    await page.goto('/admin/settings');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    await expect(page).toHaveScreenshot('admin-settings.png', screenshotOpts);
  });
});

test.describe('Admin Screenshots — Admin-Only Pages', () => {
  let token: string;

  test.beforeAll(() => {
    token = seedSession({ role: 'admin', username: 'Screenshot Admin', email: 'admin@test.local' });
  });

  test.afterAll(() => {
    cleanupSession(token);
  });

  test.beforeEach(async ({ page }) => {
    await page.clock.install({ time: FIXED_DATE });
    await loginAs(page, token);
    await proxyTiles(page);
  });

  test('user management', async ({ page }) => {
    await page.goto('/admin/users');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    await expect(page).toHaveScreenshot('admin-user-management.png', screenshotOpts);
  });
});

test.describe('Admin Screenshots — Unauthenticated', () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.install({ time: FIXED_DATE });
    await proxyTiles(page);
  });

  test('anonymous dashboard', async ({ page }) => {
    // /admin is browsable without auth — renders anonymous dashboard
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    await expect(page).toHaveScreenshot('admin-anonymous-dashboard.png', screenshotOpts);
  });

  test('editor page renders for unauthenticated user', async ({ page }) => {
    // Editor pages are now browsable without auth (guest-first flow)
    await page.goto('/admin/routes/carp');
    await page.waitForLoadState('networkidle');
    expect(page.url()).toContain('/admin/routes/carp');
    await expect(page).toHaveScreenshot('admin-anonymous-editor.png', screenshotOpts);
  });
});

test.describe('Admin Screenshots — Guest Variant', () => {
  let token: string;

  test.beforeAll(() => {
    token = seedSession({ role: 'guest', username: 'screenshot-guest', email: null });
  });

  test.afterAll(() => {
    cleanupSession(token);
  });

  test.beforeEach(async ({ page }) => {
    await page.clock.install({ time: FIXED_DATE });
    await loginAs(page, token);
    await proxyTiles(page);
  });

  test('guest save modal', async ({ page }) => {
    await page.goto('/admin/routes/carp');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Fill tagline input
    const taglineInput = page.locator('#route-tagline');
    await taglineInput.fill('Screenshot test tagline');

    // Click Save button
    const saveButton = page.getByRole('button', { name: /save/i });
    await saveButton.click();

    // Wait for guest contribution modal
    await expect(page.getByText('Thanks for your contribution')).toBeVisible({ timeout: 15000 });

    await expect(page).toHaveScreenshot('admin-guest-save-modal.png', screenshotOpts);
  });
});

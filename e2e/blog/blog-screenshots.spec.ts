import { test, expect } from '@playwright/test';
import { seedSession, loginAs, cleanupSession, proxyTiles } from './helpers.ts';

const screenshotOpts = { fullPage: true, maxDiffPixelRatio: 0.04 };
const FIXED_DATE = new Date('2025-06-15T16:00:00.000Z');

test.describe('Blog Screenshots — Public Pages', () => {
  test('homepage', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Blog homepage shows highlighted rides and latest rides
    await expect(page.locator('.blog-home')).toBeVisible();
    await expect(page.locator('h3')).toContainText('Bike adventures');

    await expect(page).toHaveScreenshot('blog-homepage.png', screenshotOpts);
  });

  test('rides index', async ({ page }) => {
    await page.goto('/rides');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    await expect(page).toHaveScreenshot('rides-index.png', screenshotOpts);
  });

  test('ride detail', async ({ page }) => {
    await page.goto('/rides/2026-01-23-winter-ride');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    await expect(page).toHaveScreenshot('ride-detail.png', screenshotOpts);
  });

  test('ride map', async ({ page }) => {
    await page.goto('/rides/2026-01-23-winter-ride/map');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);
    await expect(page).toHaveScreenshot('ride-map.png', { maxDiffPixelRatio: 0.04 });
  });

  test('tours index', async ({ page }) => {
    await page.goto('/tours');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    await expect(page).toHaveScreenshot('tours-index.png', screenshotOpts);
  });

  test('tour detail', async ({ page }) => {
    await page.goto('/tours/summer-tour');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    await expect(page).toHaveScreenshot('tour-detail.png', screenshotOpts);
  });

  test('tour ride detail', async ({ page }) => {
    await page.goto('/tours/summer-tour/tour-day-one');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    await expect(page).toHaveScreenshot('tour-ride-detail.png', screenshotOpts);
  });

  test('stats', async ({ page }) => {
    await page.goto('/stats');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    await expect(page).toHaveScreenshot('stats.png', screenshotOpts);
  });
});

test.describe('Blog Screenshots — Admin Pages', () => {
  let token: string;

  test.beforeAll(() => {
    token = seedSession({ role: 'admin', username: 'Screenshot Admin' });
  });

  test.afterAll(() => {
    cleanupSession(token);
  });

  test.beforeEach(async ({ page }) => {
    await page.clock.install({ time: FIXED_DATE });
    await loginAs(page, token);
    await proxyTiles(page);
  });

  test('rides list', async ({ page }) => {
    await page.goto('/admin/rides');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    await expect(page).toHaveScreenshot('admin-rides-list.png', screenshotOpts);
  });

  test('ride editor', async ({ page }) => {
    await page.goto('/admin/rides/2026-01-23-winter-ride');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    await expect(page).toHaveScreenshot('admin-ride-editor.png', screenshotOpts);
  });

  test('ride creation', async ({ page }) => {
    await page.goto('/admin/rides/new');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    await expect(page).toHaveScreenshot('admin-ride-creation.png', screenshotOpts);
  });

  test('settings', async ({ page }) => {
    await page.goto('/admin/settings');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Blog settings shows profile section
    await expect(page.locator('.settings-card-header').first()).toContainText('Profile');

    await expect(page).toHaveScreenshot('admin-settings.png', screenshotOpts);
  });
});

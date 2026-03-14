import { test, expect } from '@playwright/test';
import { seedSession, loginAs, cleanupSession, proxyTiles } from './helpers.ts';

const screenshotOpts = { fullPage: true, maxDiffPixelRatio: 0.04 };
const FIXED_DATE = new Date('2025-06-15T16:00:00.000Z');

test.describe('Club Screenshots — Public Pages', () => {
  test('homepage', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Club homepage shows tagline and upcoming events
    await expect(page.locator('.club-home')).toBeVisible();
    await expect(page.locator('h3')).toContainText('A demo randonneuring club');
    await expect(page.locator('.event-card')).toHaveCount(2);

    await expect(page).toHaveScreenshot('club-homepage.png', screenshotOpts);
  });

  test('events index', async ({ page }) => {
    await page.goto('/events');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    await expect(page).toHaveScreenshot('club-events-index.png', screenshotOpts);
  });

  test('upcoming event detail', async ({ page }) => {
    await page.goto('/events/2099/brm-200-ruta-del-vino');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    await expect(page).toHaveScreenshot('club-event-detail-upcoming.png', screenshotOpts);
  });

  test('past event detail with results', async ({ page }) => {
    await page.goto('/events/2024/brm-300-vuelta-rocas');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    await expect(page).toHaveScreenshot('club-event-detail-past.png', screenshotOpts);
  });

  test('route detail (brevet route)', async ({ page }) => {
    await page.goto('/routes/vuelta-rocas-300');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Brevet route shows name and distance
    await expect(page.locator('h1')).toContainText('Vuelta Rocas 300');

    await expect(page).toHaveScreenshot('club-route-detail.png', screenshotOpts);
  });

  test('places index', async ({ page }) => {
    await page.goto('/places');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    await expect(page).toHaveScreenshot('club-places-index.png', screenshotOpts);
  });
});

test.describe('Club Screenshots — Admin Pages', () => {
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

  test('event list', async ({ page }) => {
    await page.goto('/admin/events');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Club admin landing is events list
    await expect(page.locator('h1')).toContainText('Events');

    await expect(page).toHaveScreenshot('club-admin-event-list.png', screenshotOpts);
  });

  test('event editor', async ({ page }) => {
    await page.goto('/admin/events/2024/brm-300-vuelta-rocas');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Club event editor has route section and results editor
    await expect(page.locator('#event-name')).toHaveValue('BRM 300 Vuelta Rocas');

    await expect(page).toHaveScreenshot('club-admin-event-editor.png', screenshotOpts);
  });

  test('event creation', async ({ page }) => {
    await page.goto('/admin/events/new');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    await expect(page).toHaveScreenshot('club-admin-event-creation.png', screenshotOpts);
  });

  test('settings', async ({ page }) => {
    await page.goto('/admin/settings');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    await expect(page.locator('.settings-form h2').first()).toContainText('Profile');

    await expect(page).toHaveScreenshot('club-admin-settings.png', screenshotOpts);
  });
});

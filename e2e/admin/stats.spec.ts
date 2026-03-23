import { test, expect } from '@playwright/test';
import { seedSession, cleanupSession, loginAs, waitForHydration } from './helpers.ts';

test.describe('Stats page', () => {
  let token: string;

  test.beforeAll(() => {
    token = seedSession({ role: 'admin', username: 'Stats Tester' });
  });

  test.afterAll(() => {
    cleanupSession(token);
  });

  test.beforeEach(async ({ page }) => {
    await loginAs(page, token);
  });

  test('stats page loads and shows the island', async ({ page }) => {
    await page.goto('/admin/stats');
    await page.waitForLoadState('networkidle');
    await waitForHydration(page);

    // The island should render — either loading, empty state, or data
    const overview = page.locator('.stats-overview');
    await expect(overview).toBeVisible();
  });

  test('stats tab is visible in admin nav for admins', async ({ page }) => {
    await page.goto('/admin/stats');
    await page.waitForLoadState('networkidle');

    const statsTab = page.locator('a.admin-nav-link', { hasText: 'Stats' });
    await expect(statsTab).toBeVisible();
    await expect(statsTab).toHaveClass(/active/);
  });

  test('time range buttons render after hydration', async ({ page }) => {
    await page.goto('/admin/stats');
    await page.waitForLoadState('networkidle');
    await waitForHydration(page);

    // Wait for data to load (loading state to resolve)
    await page.waitForSelector('.stats-range-selector, .stats-empty-state, .stats-error', { timeout: 15000 });

    // If data loaded, range selector should be present
    const hasData = await page.locator('.stats-range-selector').count();
    if (hasData > 0) {
      const buttons = page.locator('.stats-range-btn');
      await expect(buttons).toHaveCount(4);
      await expect(buttons.first()).toHaveText('Last 30 days');
    }
  });

  test('sync button exists and is clickable', async ({ page }) => {
    await page.goto('/admin/stats');
    await page.waitForLoadState('networkidle');
    await waitForHydration(page);

    // Wait for the island to finish loading
    await page.waitForSelector('.stats-sync-btn, .stats-empty-state, .stats-error', { timeout: 15000 });

    const syncBtn = page.locator('#sync-btn');
    await expect(syncBtn).toBeVisible();
    await expect(syncBtn).toHaveText('Sync now');
  });

  test('no console errors on page load', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/admin/stats');
    await page.waitForLoadState('networkidle');
    await waitForHydration(page);

    // Wait for the island to finish its initial fetch
    await page.waitForSelector('.stats-range-selector, .stats-empty-state, .stats-error', { timeout: 15000 });

    expect(errors).toEqual([]);
  });
});

test.describe('Stats page access control', () => {
  test('non-admin cannot access stats', async ({ page }) => {
    const editorToken = seedSession({ role: 'editor', username: 'Editor User' });
    try {
      await loginAs(page, editorToken);
      const res = await page.goto('/admin/stats');
      // Should get 403 from authorize()
      expect(res?.status()).toBe(403);
    } finally {
      cleanupSession(editorToken);
    }
  });
});

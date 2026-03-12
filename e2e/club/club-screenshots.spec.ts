import { test, expect } from '@playwright/test';

const screenshotOpts = { fullPage: true, maxDiffPixelRatio: 0.04 };

test.describe('Club Screenshots — Public Pages', () => {
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

  test('places index', async ({ page }) => {
    await page.goto('/places');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    await expect(page).toHaveScreenshot('club-places-index.png', screenshotOpts);
  });

});

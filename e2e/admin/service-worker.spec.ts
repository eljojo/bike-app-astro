import { test, expect } from '@playwright/test';

test.describe('Service Worker Offline', () => {
  test('caches visited route page for offline access', async ({ page, context }) => {
    // Visit a route page to trigger SW registration
    await page.goto('/routes/carp');
    await page.waitForLoadState('networkidle');

    // Wait for SW to install and activate
    await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready;
      // Ensure the SW is controlling the page
      if (!navigator.serviceWorker.controller) {
        await new Promise<void>((resolve) => {
          navigator.serviceWorker.addEventListener('controllerchange', () => resolve());
        });
      }
    });

    // Reload to ensure the page is served through the SW and cached
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Verify images are present on the page while online
    const images = page.locator('img');
    const imageCount = await images.count();
    expect(imageCount).toBeGreaterThan(0);
    for (let i = 0; i < imageCount; i++) {
      await expect(images.nth(i)).toHaveAttribute('src', /.+/);
    }

    // Go offline
    await context.setOffline(true);

    // Navigate to the same route — should load from SW cache
    await page.goto('/routes/carp');

    // Verify page content loaded (not the offline fallback)
    await expect(page.locator('h1')).toContainText('Carp');

    // Verify images are still present in the cached page HTML
    const offlineImages = page.locator('img');
    expect(await offlineImages.count()).toBeGreaterThan(0);
    await expect(offlineImages.first()).toHaveAttribute('src', /.+/);

    // Restore online
    await context.setOffline(false);
  });

  test('shows offline fallback for uncached pages', async ({ page, context }) => {
    // Visit home page to trigger SW registration
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Wait for SW to activate
    await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) {
        await new Promise<void>((resolve) => {
          navigator.serviceWorker.addEventListener('controllerchange', () => resolve());
        });
      }
    });

    // Go offline
    await context.setOffline(true);

    // Try to visit a page we haven't cached
    await page.goto('/routes/carp');

    // Should show the offline fallback page
    await expect(page.locator('h1')).toHaveText("This page isn't available offline");
    await expect(page.locator('p')).toContainText('Visit pages while online');
    await expect(page.locator('a[href="/"]')).toBeVisible();
    await expect(page.locator('a[href="/"]')).toHaveText('Go to homepage');

    // Restore online
    await context.setOffline(false);
  });
});

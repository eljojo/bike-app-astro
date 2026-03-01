import { test, expect } from '@playwright/test';

const SKIP_SCREENSHOTS = process.env.SKIP_SCREENSHOTS === 'true';

// Helper: only assert screenshot if not skipped
async function expectScreenshot(page, name: string, options?: object) {
  if (!SKIP_SCREENSHOTS) {
    await expect(page).toHaveScreenshot(name, options);
  }
}

// Scroll through the page to trigger lazy-loaded images, then wait for all to finish loading.
async function waitForImages(page) {
  // Scroll to bottom in steps to trigger lazy loading
  await page.evaluate(async () => {
    const step = window.innerHeight;
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise(r => setTimeout(r, 100));
    }
    window.scrollTo(0, 0);
  });
  // Wait for all images to report complete
  await page.waitForFunction(() => {
    const images = Array.from(document.querySelectorAll('img'));
    return images.every(img => img.complete);
  }, { timeout: 10000 }).catch(() => {});
}

test.describe('Screenshots', () => {
  test('homepage', async ({ page }) => {
    await page.goto('/');
    await waitForImages(page);
    await expectScreenshot(page, 'homepage.png', { fullPage: true });
  });

  test('route detail', async ({ page }) => {
    await page.goto('/routes/easy-loop-around-the-canal');
    await waitForImages(page);
    await expectScreenshot(page, 'route-detail.png', { fullPage: true, maxDiffPixelRatio: 0.02 });
  });

  test('route map', async ({ page }) => {
    await page.goto('/routes/easy-loop-around-the-canal/map');
    await page.waitForSelector('.leaflet-container');
    await expect(page.locator('.leaflet-container')).toBeVisible();
  });

  test('guides index', async ({ page }) => {
    await page.goto('/guides');
    await waitForImages(page);
    await expectScreenshot(page, 'guides-index.png', { fullPage: true });
  });

  test('guide detail', async ({ page }) => {
    await page.goto('/guides/local-communities');
    await waitForImages(page);
    await expectScreenshot(page, 'guide-detail.png', { fullPage: true });
  });

  test('calendar', async ({ page }) => {
    await page.goto('/calendar');
    const showPast = page.locator('#show-past-events');
    if (await showPast.isVisible()) {
      await showPast.click();
    }
    await waitForImages(page);
    // Clip to first ~2000px — the full page is too long
    await expectScreenshot(page, 'calendar.png', { clip: { x: 0, y: 0, width: 1280, height: 2000 } });
  });

  test('about', async ({ page }) => {
    await page.goto('/about');
    await waitForImages(page);
    await expectScreenshot(page, 'about.png', { fullPage: true });
  });

  test('videos', async ({ page }) => {
    await page.goto('/videos');
    await waitForImages(page);
    // Clip to first ~2000px — the full page is too long
    await expectScreenshot(page, 'videos.png', { clip: { x: 0, y: 0, width: 1280, height: 2000 } });
  });

  test('big map', async ({ page }) => {
    await page.goto('/map');
    await page.waitForSelector('.leaflet-container');
    await expect(page.locator('.leaflet-container')).toBeVisible();
  });
});

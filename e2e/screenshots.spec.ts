import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

// Tile responses are cached to e2e/.tile-cache/ to avoid hitting staging on every run.
// On cache miss, tiles are fetched from staging and saved for future runs.
const TILE_PROXY_ORIGIN = 'https://new.ottawabybike.ca';
const TILE_CACHE_DIR = path.join(import.meta.dirname, '.tile-cache');

function tileCachePath(urlPath: string): string {
  return path.join(TILE_CACHE_DIR, urlPath.replace(/^\/api\/tiles\//, ''));
}

async function proxyTiles(page: Page) {
  await page.route('**/api/tiles/**', async (route) => {
    const url = new URL(route.request().url());
    const cached = tileCachePath(url.pathname);

    if (fs.existsSync(cached)) {
      const body = fs.readFileSync(cached);
      const contentType = cached.endsWith('.pbf') ? 'application/x-protobuf' : 'application/octet-stream';
      await route.fulfill({ status: 200, headers: { 'Content-Type': contentType }, body });
      return;
    }

    const upstream = `${TILE_PROXY_ORIGIN}${url.pathname}`;
    try {
      const res = await fetch(upstream);
      const body = Buffer.from(await res.arrayBuffer());
      if (res.ok) {
        fs.mkdirSync(path.dirname(cached), { recursive: true });
        fs.writeFileSync(cached, body);
      }
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

// Scroll through the page to trigger lazy-loaded images, then wait for all to finish loading.
async function waitForImages(page: Page) {
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
    return images.every(img => img.complete || (img.loading === 'lazy' && !img.currentSrc));
  }, undefined, { timeout: 10000 }).catch(() => {});
}

test.describe('Screenshots', () => {
  test('homepage', async ({ page }) => {
    await page.goto('/');
    await waitForImages(page);
    // Clip to 2000px — 4000px at 2x deviceScaleFactor exceeds libpng limits
    await expect(page).toHaveScreenshot('homepage.png', { clip: { x: 0, y: 0, width: 1280, height: 2000 } });
  });

  test('route detail', async ({ page }) => {
    await page.goto('/routes/ruta-rio-chillan');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot('route-detail.png', { fullPage: true, maxDiffPixelRatio: 0.02 });
  });

  test('route map redirects to detail', async ({ page }) => {
    await page.goto('/routes/ruta-rio-chillan/map');
    // Route map pages are deprecated — 301 redirect to the detail page
    // wrangler dev may add trailing slash to static file URLs
    await expect(page).toHaveURL(/\/routes\/ruta-rio-chillan\/?$/);
  });

  test('route variant map redirects to detail (default variant, no param)', async ({ page }) => {
    await page.goto('/routes/ruta-rio-chillan/map/variants-default');
    // Default variant redirect — no ?variant= param since it's the first variant
    await expect(page).toHaveURL(/\/routes\/ruta-rio-chillan\/?$/);
  });

  test('guides index', async ({ page }) => {
    await page.goto('/guides');
    await waitForImages(page);
    await expect(page).toHaveScreenshot('guides-index.png', { fullPage: true });
  });

  test('guide detail', async ({ page }) => {
    await page.goto('/guides/getting-started');
    await waitForImages(page);
    await expect(page).toHaveScreenshot('guide-detail.png', { fullPage: true });
  });

  test('calendar', async ({ page }) => {
    await page.goto('/calendar');
    const showPast = page.locator('#show-past-events');
    if (await showPast.isVisible()) {
      await showPast.click();
    }
    await waitForImages(page);
    // Clip to first ~2000px — the full page is too long
    await expect(page).toHaveScreenshot('calendar.png', { clip: { x: 0, y: 0, width: 1280, height: 2000 } });
  });

  test('about', async ({ page }) => {
    await page.goto('/about');
    await waitForImages(page);
    await expect(page).toHaveScreenshot('about.png', { fullPage: true });
  });

  test('videos', async ({ page }) => {
    await page.goto('/videos');
    await waitForImages(page);
    // Clip to first ~2000px — the full page is too long
    await expect(page).toHaveScreenshot('videos.png', { clip: { x: 0, y: 0, width: 1280, height: 2000 } });
  });

  test('homepage magazine view', async ({ page }) => {
    await page.goto('/');
    await waitForImages(page);
    // Clip to 2000px — 4000px at 2x deviceScaleFactor exceeds libpng limits
    await expect(page).toHaveScreenshot('homepage-magazine.png', { clip: { x: 0, y: 0, width: 1280, height: 2000 } });
  });

  test('communities index', async ({ page }) => {
    await page.goto('/communities');
    await waitForImages(page);
    await expect(page).toHaveScreenshot('communities-index.png', { fullPage: true });
  });

  test('big map', async ({ page }) => {
    await proxyTiles(page);
    await page.goto('/map');
    await page.waitForSelector('.maplibregl-map');
    await expect(page.locator('.maplibregl-map')).toBeVisible();
  });
});

// SSR pages with Preact islands — verify they render in the Cloudflare build.
// These catch "NoMatchingRenderer" errors where the Preact renderer is missing
// from the server bundle at runtime (the page 500s instead of rendering).
test.describe('SSR Preact islands', () => {
  test('login page renders LoginForm', async ({ page }) => {
    const response = await page.goto('/login');
    expect(response?.status()).toBe(200);
    await expect(page.locator('#login-email')).toBeVisible();
  });

  test('register redirects to login', async ({ page }) => {
    await page.goto('/register');
    // 301 redirect followed by Playwright — check final URL
    expect(page.url()).toContain('/login');
  });
});

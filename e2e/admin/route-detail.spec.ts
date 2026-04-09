/**
 * Public route detail page — rendered from admin fixture data.
 *
 * Uses the "carp" fixture (read-only) which has two variants with
 * different GPX files, enabling multi-variant rendering assertions.
 */
import { test, expect } from '@playwright/test';

test.describe('Route detail — variant downloads', () => {
  test('each variant gets its own gpxHash in the map image URL', async ({ page }) => {
    // The "carp" fixture has two variants with different GPX files.
    // Each variant's PNG download link must use a hash derived from its own GPX
    // content, not the route-level hash (which is only the first variant's).
    await page.goto('/routes/carp/');
    const pngButtons = page.locator('.route-downloads a[href*="/api/map-image/"]');
    await expect(pngButtons).toHaveCount(2);

    const href0 = await pngButtons.nth(0).getAttribute('href');
    const href1 = await pngButtons.nth(1).getAttribute('href');

    // URL format: /api/map-image/route/{hash}/{slug}--{variant}-full-en.png
    const hashFromUrl = (href: string) => href.split('/')[4];
    const hash0 = hashFromUrl(href0!);
    const hash1 = hashFromUrl(href1!);

    expect(hash0).toHaveLength(16);
    expect(hash1).toHaveLength(16);
    expect(hash0).not.toBe(hash1);
  });
});

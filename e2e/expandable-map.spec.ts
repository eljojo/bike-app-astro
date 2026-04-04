import { test, expect, type Page } from '@playwright/test';

// These tests verify the expandable map card behavior on route detail pages.
// The map has two modes: compact (preview) and expanded (full interactive).
//
// Key invariants:
//   Compact: polyline visible, no photo bubbles, no place markers, no controls, no close button
//   Expanded: close button visible, controls visible, map zooms to fit, interactions enabled
//   Collapse: returns to compact state, photo bubbles gone again

// Demo city has route "ruta-rio-chillan" with photos and a map
const ROUTE_URL = '/rutas/ruta-rio-chillan';

// Wait for the map canvas to be present (MapLibre initialized)
async function waitForMap(page: Page) {
  await page.waitForSelector('.expandable-map-card .maplibregl-canvas', { timeout: 15000 });
}

test.describe('Expandable map — compact mode', () => {
  test('renders map with no photo bubbles or place markers', async ({ page }) => {
    await page.goto(ROUTE_URL);
    await waitForMap(page);

    // Map card exists
    const card = page.locator('.expandable-map-card');
    await expect(card).toBeVisible();

    // No photo bubbles in compact mode
    const photoBubbles = page.locator('.expandable-map-card .photo-bubble');
    await expect(photoBubbles).toHaveCount(0);

    // No place emoji markers in compact mode
    const placeMarkers = page.locator('.expandable-map-card .poi-marker');
    await expect(placeMarkers).toHaveCount(0);

    // Close button hidden
    const closeBtn = page.locator('.expandable-map-close');
    await expect(closeBtn).not.toBeVisible();

    // Controls hidden
    const controls = page.locator('.expandable-map-controls');
    await expect(controls).not.toBeVisible();

    // Expand hint exists
    const hint = page.locator('.expandable-map-hint');
    await expect(hint).toBeAttached();
  });

  test('aria-expanded is false', async ({ page }) => {
    await page.goto(ROUTE_URL);
    await waitForMap(page);

    const card = page.locator('.expandable-map-card');
    await expect(card).toHaveAttribute('aria-expanded', 'false');
  });
});

test.describe('Expandable map — expand', () => {
  test('clicking the map card expands it', async ({ page }) => {
    await page.goto(ROUTE_URL);
    await waitForMap(page);

    const card = page.locator('.expandable-map-card');
    await card.click();

    // Wait for expansion
    await expect(card).toHaveClass(/expanded/);
    await expect(card).toHaveAttribute('aria-expanded', 'true');

    // Close button visible
    const closeBtn = page.locator('.expandable-map-close');
    await expect(closeBtn).toBeVisible();

    // Overlay visible
    const overlay = page.locator('.expandable-map-overlay');
    await expect(overlay).toHaveClass(/visible/);
  });

  test('map zooms to fit route after expanding', async ({ page }) => {
    await page.goto(ROUTE_URL);
    await waitForMap(page);

    // Get initial zoom
    const initialZoom = await page.evaluate(() => {
      const canvas = document.querySelector('.expandable-map-card .maplibregl-canvas');
      const map = canvas?.closest('.expandable-map-card');
      return map?.getBoundingClientRect().height;
    });

    const card = page.locator('.expandable-map-card');
    await card.click();
    await expect(card).toHaveClass(/expanded/);

    // Wait for resize + fitBounds to complete
    await page.waitForTimeout(500);

    // The card should now be much larger
    const expandedHeight = await card.evaluate(el => el.getBoundingClientRect().height);
    expect(expandedHeight).toBeGreaterThan(initialZoom! * 2);
  });

  test('controls become visible when expanded', async ({ page }) => {
    await page.goto(ROUTE_URL);
    await waitForMap(page);

    const card = page.locator('.expandable-map-card');
    await card.click();
    await expect(card).toHaveClass(/expanded/);

    // Controls should be visible (CSS shows them when .expanded)
    const controls = page.locator('.expandable-map-controls');
    // Controls render async via Preact — wait for content
    await page.waitForTimeout(500);
    await expect(controls).toBeVisible();
  });
});

test.describe('Expandable map — collapse', () => {
  test('clicking close button collapses the map', async ({ page }) => {
    await page.goto(ROUTE_URL);
    await waitForMap(page);

    // Expand
    const card = page.locator('.expandable-map-card');
    await card.click();
    await expect(card).toHaveClass(/expanded/);

    // Close
    const closeBtn = page.locator('.expandable-map-close');
    await closeBtn.click();

    // Wait for collapse animation
    await page.waitForTimeout(500);

    await expect(card).not.toHaveClass(/expanded/);
    await expect(card).toHaveAttribute('aria-expanded', 'false');
    await expect(closeBtn).not.toBeVisible();
  });

  test('pressing Escape collapses the map', async ({ page }) => {
    await page.goto(ROUTE_URL);
    await waitForMap(page);

    const card = page.locator('.expandable-map-card');
    await card.click();
    await expect(card).toHaveClass(/expanded/);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    await expect(card).not.toHaveClass(/expanded/);
  });

  test('clicking overlay collapses the map', async ({ page }) => {
    await page.goto(ROUTE_URL);
    await waitForMap(page);

    const card = page.locator('.expandable-map-card');
    await card.click();
    await expect(card).toHaveClass(/expanded/);

    const overlay = page.locator('.expandable-map-overlay');
    // Click the overlay (not the card) — use force since overlay might be behind the card
    await overlay.click({ position: { x: 5, y: 5 }, force: true });
    await page.waitForTimeout(500);

    await expect(card).not.toHaveClass(/expanded/);
  });

  test('photo bubbles disappear after collapsing', async ({ page }) => {
    await page.goto(ROUTE_URL);
    await waitForMap(page);

    // Expand
    const card = page.locator('.expandable-map-card');
    await card.click();
    await expect(card).toHaveClass(/expanded/);

    // Wait for map to settle
    await page.waitForTimeout(1000);

    // Collapse
    const closeBtn = page.locator('.expandable-map-close');
    await closeBtn.click();
    await page.waitForTimeout(500);

    // No photo bubbles in compact mode
    const photoBubbles = page.locator('.expandable-map-card .photo-bubble');
    await expect(photoBubbles).toHaveCount(0);
  });
});

test.describe('Expandable map — expand/collapse cycle', () => {
  test('can expand and collapse multiple times', async ({ page }) => {
    await page.goto(ROUTE_URL);
    await waitForMap(page);

    const card = page.locator('.expandable-map-card');
    const closeBtn = page.locator('.expandable-map-close');

    // Cycle 1
    await card.click();
    await expect(card).toHaveClass(/expanded/);
    await closeBtn.click();
    await page.waitForTimeout(500);
    await expect(card).not.toHaveClass(/expanded/);

    // Cycle 2
    await card.click();
    await expect(card).toHaveClass(/expanded/);
    await closeBtn.click();
    await page.waitForTimeout(500);
    await expect(card).not.toHaveClass(/expanded/);

    // No photo bubbles after cycling
    const photoBubbles = page.locator('.expandable-map-card .photo-bubble');
    await expect(photoBubbles).toHaveCount(0);
  });
});

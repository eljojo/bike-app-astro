import { test, expect, type Page } from '@playwright/test';

// Tests for the expandable map card on route detail pages.
// The map must be compact (polyline only) on load and expand to full interactive on click.
//
// KEY INVARIANT: No photo bubbles or place markers in compact mode. Ever.
// This was a recurring regression — MapControls useEffect reads localStorage
// and can turn layers on even when the controls panel is CSS-hidden.

const ROUTE_URL = '/routes/ruta-rio-chillan';

// Wait for the map card and its layers to settle.
// MapLibre canvas may not render in headless/no-GPU environments, but the
// DOM elements (photo bubbles, controls, etc.) are created by JS regardless.
// We wait for the card + enough time for session.start(), MapControls mount,
// and any idle-triggered layer setup to complete.
async function waitForMapSettled(page: Page) {
  await page.waitForSelector('.expandable-map-card', { state: 'attached', timeout: 10000 });
  // Wait for: map.on('load') → MapControls render → useEffect → onToggle callbacks
  // AND map idle → photo layer syncHandler → DOM bubble creation
  await page.waitForTimeout(5000);
}

test.describe('Compact mode — no photo bubbles', () => {
  test('no photo bubbles on initial load (clean localStorage)', async ({ page }) => {
    const response = await page.goto(ROUTE_URL);
    expect(response?.status()).toBe(200);

    // Verify the page has the map card
    const html = await page.content();
    expect(html).toContain('expandable-map-card');

    await waitForMapSettled(page);

    const bubbles = page.locator('.expandable-map-card .photo-bubble');
    await expect(bubbles).toHaveCount(0);
  });

  test('no photo bubbles even when localStorage map-photos=true', async ({ page }) => {
    // THIS IS THE SPECIFIC BUG: localStorage turns photos on in compact mode
    await page.goto(ROUTE_URL);
    await page.evaluate(() => localStorage.setItem('map-photos', 'true'));
    await page.reload();
    await waitForMapSettled(page);

    const bubbles = page.locator('.expandable-map-card .photo-bubble');
    await expect(bubbles).toHaveCount(0);
  });

  test('no place markers on initial load', async ({ page }) => {
    await page.goto(ROUTE_URL);
    await waitForMapSettled(page);

    const markers = page.locator('.expandable-map-card .poi-marker');
    await expect(markers).toHaveCount(0);
  });

  test('close button is not visible', async ({ page }) => {
    await page.goto(ROUTE_URL);
    await waitForMapSettled(page);

    await expect(page.locator('.expandable-map-close')).not.toBeVisible();
  });

  test('aria-expanded is false', async ({ page }) => {
    const response = await page.goto(ROUTE_URL);
    // If the page returns 500, the server is broken — fail with a clear message
    if (response?.status() !== 200) {
      const html = await page.content();
      throw new Error(`Route page returned ${response?.status()}. Body preview: ${html.substring(0, 500)}`);
    }
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'e2e/test-results/debug-route-detail.png', fullPage: true });

    const card = page.locator('.expandable-map-card');
    await expect(card).toHaveAttribute('aria-expanded', 'false');
  });
});

test.describe('Expand and collapse', () => {
  test('clicking card expands map', async ({ page }) => {
    await page.goto(ROUTE_URL);
    await waitForMapSettled(page);

    const card = page.locator('.expandable-map-card');
    await card.click();

    await expect(card).toHaveClass(/expanded/);
    await expect(card).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('.expandable-map-close')).toBeVisible();
    await expect(page.locator('.expandable-map-overlay')).toHaveClass(/visible/);
  });

  test('close button collapses map', async ({ page }) => {
    await page.goto(ROUTE_URL);
    await waitForMapSettled(page);

    const card = page.locator('.expandable-map-card');
    await card.click();
    await expect(card).toHaveClass(/expanded/);

    await page.locator('.expandable-map-close').click();
    await page.waitForTimeout(500);

    await expect(card).not.toHaveClass(/expanded/);
    await expect(card).toHaveAttribute('aria-expanded', 'false');
  });

  test('Escape key collapses map', async ({ page }) => {
    await page.goto(ROUTE_URL);
    await waitForMapSettled(page);

    const card = page.locator('.expandable-map-card');
    await card.click();
    await expect(card).toHaveClass(/expanded/);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    await expect(card).not.toHaveClass(/expanded/);
  });

  test('no photo bubbles after collapse', async ({ page }) => {
    await page.goto(ROUTE_URL);
    await waitForMapSettled(page);

    const card = page.locator('.expandable-map-card');
    await card.click();
    await expect(card).toHaveClass(/expanded/);

    // Wait for expand to settle
    await page.waitForTimeout(1000);

    // Collapse
    await page.locator('.expandable-map-close').click();
    await page.waitForTimeout(1000);

    const bubbles = page.locator('.expandable-map-card .photo-bubble');
    await expect(bubbles).toHaveCount(0);
  });

  test('expand-collapse-expand cycle works', async ({ page }) => {
    await page.goto(ROUTE_URL);
    await waitForMapSettled(page);

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

    // Still no bubbles
    const bubbles = page.locator('.expandable-map-card .photo-bubble');
    await expect(bubbles).toHaveCount(0);
  });
});

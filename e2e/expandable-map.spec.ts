import { test, expect, type Page } from '@playwright/test';

// Tests for the expandable map card on route detail pages.
// The map must be compact (polyline only) on load and expand to full interactive on click.
//
// KEY INVARIANT: No photo bubbles or place markers in compact mode. Ever.
// This was a recurring regression — MapControls useEffect reads localStorage
// and can turn layers on even when the controls panel is CSS-hidden.

const ROUTE_URL = '/routes/ruta-rio-chillan/';

// Assert no photo bubbles are visible (DOM elements may exist but be display:none)
async function expectNoVisibleBubbles(page: Page) {
  const visibleCount = await page.evaluate(() => {
    const bubbles = document.querySelectorAll('.expandable-map-card .photo-bubble');
    return Array.from(bubbles).filter(b => (b as HTMLElement).style.display !== 'none').length;
  });
  expect(visibleCount).toBe(0);
}

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

// Check if WebGL rendering actually works. Photo bubbles require MapLibre's
// queryRenderedFeatures which needs real GPU-backed WebGL — not just the
// canvas element (which MapLibre creates even without GPU).
// Headless CI has the canvas but can't render, so bubbles never appear.
async function hasWorkingWebGL(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('webgl2');
    if (!gl) return false;
    // Check if the renderer is a real GPU, not a software fallback
    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    if (debugInfo) {
      const renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
      // SwiftShader / llvmpipe = software rendering, queryRenderedFeatures won't work
      if (/swiftshader|llvmpipe/i.test(renderer)) return false;
    }
    return true;
  });
}

test.describe('Compact mode — no photo bubbles', () => {
  test('no photo bubbles on initial load (clean localStorage)', async ({ page }) => {
    const response = await page.goto(ROUTE_URL);
    expect(response?.status()).toBe(200);

    // Verify the page has the map card with photo data
    const html = await page.content();
    expect(html).toContain('expandable-map-card');
    expect(html).toContain('data-photos');

    await waitForMapSettled(page);

    // Verify WebGL rendering works — if not, the test can't verify DOM bubbles
    const webglWorks = await hasWorkingWebGL(page);

    if (!webglWorks) {
      // No hardware WebGL — test can't verify bubbles.
      // Check that at least the photo data exists so the test isn't vacuous.
      const hasPhotos = await page.evaluate(() => {
        const card = document.getElementById('route-detail-map');
        const photos = JSON.parse(card?.dataset.photos || '[]');
        return photos.length;
      });
      expect(hasPhotos).toBeGreaterThan(0);
      console.warn('MapLibre did not initialize (no WebGL) — skipping bubble DOM check');
      return;
    }

    // MapLibre IS running — check for actual photo bubbles
    
    await expectNoVisibleBubbles(page);
  });

  test('no photo bubbles even when localStorage map-photos=true', async ({ page }) => {
    // THIS IS THE SPECIFIC BUG: localStorage turns photos on in compact mode
    await page.goto(ROUTE_URL);
    await page.evaluate(() => localStorage.setItem('map-photos', 'true'));
    await page.reload();
    await waitForMapSettled(page);

    
    await expectNoVisibleBubbles(page);
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

test.describe('Photo layer lifecycle', () => {
  // These tests require MapLibre with WebGL to render photo bubbles.
  // In headless CI without GPU, MapLibre may not initialize — skip gracefully.

  test('photos appear when expanded and localStorage map-photos=true', async ({ page }) => {
    await page.goto(ROUTE_URL);
    await page.evaluate(() => localStorage.setItem('map-photos', 'true'));
    await page.reload();
    await waitForMapSettled(page);

    if (!await hasWorkingWebGL(page)) {
      console.warn('No hardware WebGL — skipping photo bubble lifecycle test');
      return;
    }

    // Compact: no visible bubbles
    await expectNoVisibleBubbles(page);

    // Expand
    const card = page.locator('.expandable-map-card');
    await card.evaluate(el => (el as HTMLElement).click());
    await expect(card).toHaveClass(/expanded/, { timeout: 10000 });

    // Wait for: expand animation (350ms) + resize + onExpand callback +
    // setVisible(true) + triggerRepaint + idle event + syncHandler creates bubbles
    await page.waitForTimeout(3000);

    // Expanded with map-photos=true: photos should be visible
    const visibleCount = await page.evaluate(() => {
      const bubbles = document.querySelectorAll('.expandable-map-card .photo-bubble');
      return Array.from(bubbles).filter(b => (b as HTMLElement).style.display !== 'none').length;
    });
    expect(visibleCount).toBeGreaterThan(0);
  });

  test('photos disappear after collapsing', async ({ page }) => {
    await page.goto(ROUTE_URL);
    await page.evaluate(() => localStorage.setItem('map-photos', 'true'));
    await page.reload();
    await waitForMapSettled(page);

    if (!await hasWorkingWebGL(page)) {
      console.warn('No hardware WebGL — skipping photo bubble lifecycle test');
      return;
    }

    // Expand
    const card = page.locator('.expandable-map-card');
    await card.evaluate(el => (el as HTMLElement).click());
    await expect(card).toHaveClass(/expanded/, { timeout: 10000 });
    await page.waitForTimeout(2000);

    // Verify photos appeared
    const expandedBubbles = page.locator('.expandable-map-card .photo-bubble');
    expect(await expandedBubbles.count()).toBeGreaterThan(0);

    // Collapse
    await page.locator('.expandable-map-close').click();
    await page.waitForTimeout(1000);

    // Compact again: bubbles hidden (DOM elements may exist but display:none)
    const visibleCount = await page.evaluate(() => {
      const bubbles = document.querySelectorAll('.expandable-map-card .photo-bubble');
      return Array.from(bubbles).filter(b => (b as HTMLElement).style.display !== 'none').length;
    });
    expect(visibleCount).toBe(0);
  });

  test('photos off in compact even after expand-collapse cycle with photos on', async ({ page }) => {
    await page.goto(ROUTE_URL);
    await page.evaluate(() => localStorage.setItem('map-photos', 'true'));
    await page.reload();
    await waitForMapSettled(page);

    if (!await hasWorkingWebGL(page)) {
      console.warn('No hardware WebGL — skipping photo bubble lifecycle test');
      return;
    }

    const card = page.locator('.expandable-map-card');
    const closeBtn = page.locator('.expandable-map-close');

    // Cycle 1: expand (photos on) -> collapse (photos off)
    await card.evaluate(el => (el as HTMLElement).click());
    await expect(card).toHaveClass(/expanded/, { timeout: 10000 });
    await page.waitForTimeout(2000);
    const cycle1Bubbles = await page.locator('.expandable-map-card .photo-bubble').count();
    expect(cycle1Bubbles).toBeGreaterThan(0);
    await closeBtn.click();
    await page.waitForTimeout(1000);
    await expectNoVisibleBubbles(page);

    // Cycle 2: expand again (photos should come back) -> collapse (gone again)
    await card.evaluate(el => (el as HTMLElement).click());
    await expect(card).toHaveClass(/expanded/, { timeout: 10000 });
    await page.waitForTimeout(2000);
    const cycle2Bubbles = await page.locator('.expandable-map-card .photo-bubble').count();
    expect(cycle2Bubbles).toBeGreaterThan(0);
    await closeBtn.click();
    await page.waitForTimeout(1000);
    await expectNoVisibleBubbles(page);
  });
});

test.describe('Expand and collapse', () => {
  test('clicking card expands map', async ({ page }) => {
    await page.goto(ROUTE_URL);
    await waitForMapSettled(page);

    const card = page.locator('.expandable-map-card');
    await card.evaluate(el => (el as HTMLElement).click());

    await expect(card).toHaveClass(/expanded/, { timeout: 10000 });
    await expect(card).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('.expandable-map-close')).toBeVisible();
    await expect(page.locator('.expandable-map-overlay')).toHaveClass(/visible/);
  });

  test('close button collapses map', async ({ page }) => {
    await page.goto(ROUTE_URL);
    await waitForMapSettled(page);

    const card = page.locator('.expandable-map-card');
    await card.evaluate(el => (el as HTMLElement).click());
    await expect(card).toHaveClass(/expanded/, { timeout: 10000 });

    await page.locator('.expandable-map-close').click();
    await page.waitForTimeout(500);

    await expect(card).not.toHaveClass(/expanded/);
    await expect(card).toHaveAttribute('aria-expanded', 'false');
  });

  test('Escape key collapses map', async ({ page }) => {
    await page.goto(ROUTE_URL);
    await waitForMapSettled(page);

    const card = page.locator('.expandable-map-card');
    await card.evaluate(el => (el as HTMLElement).click());
    await expect(card).toHaveClass(/expanded/, { timeout: 10000 });

    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    await expect(card).not.toHaveClass(/expanded/);
  });

  test('no photo bubbles after collapse', async ({ page }) => {
    await page.goto(ROUTE_URL);
    await waitForMapSettled(page);

    const card = page.locator('.expandable-map-card');
    await card.evaluate(el => (el as HTMLElement).click());
    await expect(card).toHaveClass(/expanded/, { timeout: 10000 });

    // Wait for expand to settle
    await page.waitForTimeout(1000);

    // Collapse
    await page.locator('.expandable-map-close').click();
    await page.waitForTimeout(1000);

    await expectNoVisibleBubbles(page);
  });

  test('expand-collapse-expand cycle works', async ({ page }) => {
    await page.goto(ROUTE_URL);
    await waitForMapSettled(page);

    const card = page.locator('.expandable-map-card');
    const closeBtn = page.locator('.expandable-map-close');

    // Cycle 1
    await card.evaluate(el => (el as HTMLElement).click());
    await expect(card).toHaveClass(/expanded/, { timeout: 10000 });
    await closeBtn.click();
    await page.waitForTimeout(500);
    await expect(card).not.toHaveClass(/expanded/);

    // Cycle 2
    await card.evaluate(el => (el as HTMLElement).click());
    await expect(card).toHaveClass(/expanded/, { timeout: 10000 });
    await closeBtn.click();
    await page.waitForTimeout(500);
    await expect(card).not.toHaveClass(/expanded/);

    // Still no bubbles
    await expectNoVisibleBubbles(page);
  });
});

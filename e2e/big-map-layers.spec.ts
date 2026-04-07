import { test, expect, type Page } from '@playwright/test';

// Tests for the big map at /map/ — place markers (emoji POI layer) and
// bike paths tile manifest. Both rely on queryRenderedFeatures which requires
// real hardware WebGL — skip gracefully on software renderers.

async function hasWorkingWebGL(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('webgl2');
    if (!gl) return false;
    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    if (debugInfo) {
      const renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
      if (/swiftshader|llvmpipe/i.test(renderer)) return false;
    }
    return true;
  });
}

const MAP_URL = '/map/';

test.describe('BigMap — place markers', () => {
  test('place markers appear on default routes view', async ({ page }) => {
    if (!await hasWorkingWebGL(page)) {
      console.warn('No hardware WebGL — skipping place markers test');
      test.skip();
    }

    const placesResponse = page.waitForResponse(
      resp => resp.url().includes('/places/geo/places.geojson') && resp.status() === 200,
    );

    await page.goto(MAP_URL);
    await placesResponse;

    const poiMarkers = page.locator('.poi-marker');
    await expect(poiMarkers.first()).toBeAttached({ timeout: 15000 });

    const count = await poiMarkers.count();
    expect(count).toBeGreaterThan(0);
  });

  test('clicking a place marker shows a popup with text', async ({ page }) => {
    if (!await hasWorkingWebGL(page)) {
      console.warn('No hardware WebGL — skipping place marker popup test');
      test.skip();
    }

    const placesResponse = page.waitForResponse(
      resp => resp.url().includes('/places/geo/places.geojson') && resp.status() === 200,
    );

    await page.goto(MAP_URL);
    await placesResponse;

    const poiMarkers = page.locator('.poi-marker');
    await expect(poiMarkers.first()).toBeAttached({ timeout: 15000 });

    await poiMarkers.first().click();

    const popup = page.locator('.maplibregl-popup');
    await expect(popup).toBeAttached({ timeout: 5000 });

    const text = await popup.textContent();
    expect(text?.trim().length).toBeGreaterThan(0);
  });
});

test.describe('BigMap — bike paths view', () => {
  test('switching to paths view loads tile manifest', async ({ page }) => {
    if (!await hasWorkingWebGL(page)) {
      console.warn('No hardware WebGL — skipping bike paths tile manifest test');
      test.skip();
    }

    await page.goto(MAP_URL);

    const pathsButton = page.locator('[data-map-view="paths"]');
    await expect(pathsButton).toBeAttached();

    const manifestResponse = page.waitForResponse(
      resp => resp.url().includes('manifest.json') && resp.status() === 200,
    );

    await pathsButton.click();

    await manifestResponse;

    await expect(pathsButton).toHaveClass(/active/);
  });
});

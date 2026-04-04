import { test, expect, type Page } from '@playwright/test';

// Pre-refactor safety net for map components.
// Tests the DOM contract (data attributes, controls, containers) that
// the map factory refactor must preserve. No WebGL needed for DOM-only
// tests, but MapControls tests require WebGL (renders inside map.on('load')).

// Check if WebGL rendering actually works (same as expandable-map.spec.ts).
// MapControls is rendered inside map.on('load') which requires a working map.
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

// Demo city routes: ruta-rio-chillan (4 photos, 1 video, 1 variant)
const ROUTE_URL = '/routes/ruta-rio-chillan/';
const MAP_URL = '/map/';
const BIKE_PATH_URL = '/bike-paths/red-de-ciclovias/ciclovia-avenida-ecuador/';

test.describe('RouteDetailMap — DOM contract', () => {
  test('map card has required data attributes', async ({ page }) => {
    await page.goto(ROUTE_URL);
    const card = page.locator('.expandable-map-card');
    await expect(card).toBeAttached();
    await expect(card).toHaveAttribute('data-polylines');
    await expect(card).toHaveAttribute('data-photos');
    await expect(card).toHaveAttribute('data-cdn-url');
    await expect(card).toHaveAttribute('aria-expanded', 'false');
  });

  test('map GL container exists inside card', async ({ page }) => {
    await page.goto(ROUTE_URL);
    const gl = page.locator('.expandable-map-card .expandable-map-gl');
    await expect(gl).toBeAttached();
  });

  test('map controls container exists', async ({ page }) => {
    await page.goto(ROUTE_URL);
    const controls = page.locator('.expandable-map-card .expandable-map-controls');
    await expect(controls).toBeAttached();
  });

  test('close button exists but not visible in compact mode', async ({ page }) => {
    await page.goto(ROUTE_URL);
    const close = page.locator('.expandable-map-close');
    await expect(close).toBeAttached();
    await expect(close).not.toBeVisible();
  });

  test('polylines data is valid JSON array', async ({ page }) => {
    await page.goto(ROUTE_URL);
    const data = await page.locator('.expandable-map-card').getAttribute('data-polylines');
    const polylines = JSON.parse(data!);
    expect(Array.isArray(polylines)).toBe(true);
    expect(polylines.length).toBeGreaterThan(0);
    expect(polylines[0]).toHaveProperty('encoded');
  });

  test('photos data is valid JSON array with geo coordinates', async ({ page }) => {
    await page.goto(ROUTE_URL);
    const data = await page.locator('.expandable-map-card').getAttribute('data-photos');
    const photos = JSON.parse(data!);
    expect(Array.isArray(photos)).toBe(true);
    expect(photos.length).toBeGreaterThan(0);
    expect(photos[0]).toHaveProperty('lat');
    expect(photos[0]).toHaveProperty('lng');
    expect(photos[0]).toHaveProperty('key');
  });
});

test.describe('BikePathMap — DOM contract', () => {
  test('map card has required data attributes', async ({ page }) => {
    await page.goto(BIKE_PATH_URL);
    const card = page.locator('.expandable-map-card');
    await expect(card).toBeAttached();
    await expect(card).toHaveAttribute('aria-expanded', 'false');
  });

  test('map GL container exists', async ({ page }) => {
    await page.goto(BIKE_PATH_URL);
    const gl = page.locator('.expandable-map-card .expandable-map-gl');
    await expect(gl).toBeAttached();
  });

  test('close button exists', async ({ page }) => {
    await page.goto(BIKE_PATH_URL);
    await expect(page.locator('.expandable-map-close')).toBeAttached();
  });
});

test.describe('BigMap — DOM contract', () => {
  test('map container exists and is full size', async ({ page }) => {
    await page.goto(MAP_URL);
    const map = page.locator('#big-map');
    await expect(map).toBeAttached();
    await expect(map).toHaveAttribute('data-routes');
    await expect(map).toHaveAttribute('data-places');
    await expect(map).toHaveAttribute('data-center');
  });

  test('routes data is valid JSON array', async ({ page }) => {
    await page.goto(MAP_URL);
    const data = await page.locator('#big-map').getAttribute('data-routes');
    const routes = JSON.parse(data!);
    expect(Array.isArray(routes)).toBe(true);
    expect(routes.length).toBeGreaterThan(0);
    expect(routes[0]).toHaveProperty('polyline');
    expect(routes[0]).toHaveProperty('name');
  });

  test('controls container exists', async ({ page }) => {
    await page.goto(MAP_URL);
    await expect(page.locator('#big-map-controls')).toBeAttached();
  });

  test('layer toggle exists with Routes and Bike Paths buttons', async ({ page }) => {
    await page.goto(MAP_URL);
    const toggle = page.locator('#map-layer-toggle');
    await expect(toggle).toBeAttached();
    await expect(toggle.locator('[data-map-view="routes"]')).toBeAttached();
    await expect(toggle.locator('[data-map-view="paths"]')).toBeAttached();
  });

  test('routes button is active by default', async ({ page }) => {
    await page.goto(MAP_URL);
    const routesBtn = page.locator('[data-map-view="routes"]');
    await expect(routesBtn).toHaveClass(/active/);
  });
});

test.describe('MapControls — DOM contract', () => {
  test('route detail map renders Phosphor icon controls after hydration', async ({ page }) => {
    await page.goto(ROUTE_URL);
    if (!await hasWorkingWebGL(page)) {
      console.warn('No hardware WebGL — skipping MapControls hydration test');
      test.skip();
    }
    // MapControls renders after map.on('load') — wait for controls to appear
    const controls = page.locator('.expandable-map-controls .map-controls');
    await expect(controls).toBeAttached({ timeout: 10000 });
    // Should have camera and map-pin buttons (photos + places)
    const buttons = controls.locator('.map-control-btn');
    expect(await buttons.count()).toBeGreaterThanOrEqual(2);
  });

  test('big map renders controls after hydration', async ({ page }) => {
    await page.goto(MAP_URL);
    if (!await hasWorkingWebGL(page)) {
      console.warn('No hardware WebGL — skipping MapControls hydration test');
      test.skip();
    }
    const controls = page.locator('#big-map-controls .map-controls');
    await expect(controls).toBeAttached({ timeout: 10000 });
    const buttons = controls.locator('.map-control-btn');
    expect(await buttons.count()).toBeGreaterThanOrEqual(2);
  });
});

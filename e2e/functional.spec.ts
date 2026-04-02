import { test, expect } from '@playwright/test';

// GPX downloads — verify .gpx files are served with correct content type.
test.describe('GPX downloads', () => {
  test('route GPX download returns valid GPX', async ({ request }) => {
    const response = await request.get('/routes/ruta-rio-chillan/default.gpx');
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('application/gpx+xml');
    const body = await response.text();
    expect(body).toContain('<gpx');
    expect(body).toContain('xmlns="http://www.topografix.com/GPX/1/1"');
  });
});

// Magazine homepage — verify translated content in secondary locale.
// Demo city: default locale es-CL, secondary locale fr.
// Featured route "Ruta Río Chillán" → translated "Parcours Rivière Chillán".
test.describe('Magazine homepage translations', () => {
  test('default locale shows route names and facts in default language', async ({ page }) => {
    await page.goto('/');
    const featured = page.locator('.magazine-featured');
    await expect(featured.locator('.featured-route-name')).toContainText('Ruta Río Chillán');

    const facts = page.locator('.magazine-facts');
    await expect(facts).toContainText('Chillán está en el corazón del Valle del Ñuble');
  });

  test('secondary locale shows translated route names and taglines', async ({ page }) => {
    await page.goto('/fr');
    const featured = page.locator('.magazine-featured');
    await expect(featured.locator('.featured-route-name')).toContainText('Parcours Rivière Chillán');
    await expect(featured.locator('.featured-route-meta')).toContainText('Une balade le long de la rivière Chillán');
  });

  test('secondary locale shows translated facts', async ({ page }) => {
    await page.goto('/fr');
    const facts = page.locator('.magazine-facts');
    await expect(facts).toContainText('Chillán est au coeur de la vallée du Ñuble');
  });

  test('secondary locale explore routes show translated names', async ({ page }) => {
    await page.goto('/fr');
    const explore = page.locator('.magazine-explore');
    await expect(explore).toContainText('Balade au Centre-Ville');
  });

  test('secondary locale featured route links use translated slug', async ({ page }) => {
    await page.goto('/fr');
    const featuredLink = page.locator('.featured-route-card');
    await expect(featuredLink).toHaveAttribute('href', /\/fr\/parcours\/parcours-riviere-chillan/);
  });
});

// Bike path detail — verify facts table renders data computed from GeoJSON geometry.
// Ciclovía Avenida Ecuador is a real bike path in Chillán (demo city), with geo data
// from Overpass stored in .cache/bikepath-geometry/demo/. The facts table must show
// length computed from the GeoJSON — this is the integration test for the full chain:
// geo file → loadBikePathEntries() → virtual module → rendered HTML.
// Nav links — "Ride" and "Community" link to the current sub-section.
test.describe('Nav contextual links', () => {
  test('Ride nav links to /bike-paths when on a bike path page', async ({ page }) => {
    await page.goto('/bike-paths/ciclovia-avenida-ecuador');
    const rideLink = page.locator('.top-nav a.nav-active');
    await expect(rideLink).toHaveAttribute('href', '/bike-paths');
  });

  test('Ride nav links to /routes when on a route page', async ({ page }) => {
    await page.goto('/routes/ruta-rio-chillan');
    const rideLink = page.locator('.top-nav a.nav-active');
    await expect(rideLink).toHaveAttribute('href', '/routes');
  });

  test('secondary locale: Ride nav links to translated bike-paths', async ({ page }) => {
    await page.goto('/fr/pistes-cyclables/ciclovia-avenida-ecuador');
    const rideLink = page.locator('.top-nav a.nav-active');
    await expect(rideLink).toHaveAttribute('href', '/fr/pistes-cyclables');
  });

  test('Community nav is active on event detail page and links to /calendar', async ({ page }) => {
    await page.goto('/events/2026/demo-ride');
    const communityLink = page.locator('.top-nav a.nav-active');
    // Demo city default locale is es-CL: "Comunidad"
    await expect(communityLink).toContainText('Comunidad');
    await expect(communityLink).toHaveAttribute('href', '/calendar');
  });
});

test.describe('Bike path detail page', () => {
  test('facts table shows length computed from geo file', async ({ page }) => {
    await page.goto('/bike-paths/ciclovia-avenida-ecuador');
    const factsTable = page.locator('.bike-path-facts-table');
    await expect(factsTable).toBeVisible();
    // 4 OSM way segments totaling ~3.1 km
    await expect(factsTable).toContainText('3.1 km');
  });

  test('facts table shows surface type', async ({ page }) => {
    await page.goto('/bike-paths/ciclovia-avenida-ecuador');
    const factsTable = page.locator('.bike-path-facts-table');
    await expect(factsTable).toContainText('paved');
  });

  test('facts table shows separation and lighting', async ({ page }) => {
    await page.goto('/bike-paths/ciclovia-avenida-ecuador');
    const factsTable = page.locator('.bike-path-facts-table');
    // highway: cycleway → separated from traffic
    await expect(factsTable).toContainText('Separado del tráfico');
    // lit: yes
    await expect(factsTable).toContainText('Sí');
  });
});

// Network page E2E tests live in e2e/admin/ suite which has self-contained
// fixture data with network entries. The public E2E demo city depends on
// the bike-routes data repo which may not have network data yet.

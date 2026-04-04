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
    await page.goto('/bike-paths/red-de-ciclovias/ciclovia-avenida-ecuador');
    const rideLink = page.locator('.top-nav a.nav-active');
    await expect(rideLink).toHaveAttribute('href', '/bike-paths/');
  });

  test('Ride nav links to /routes when on a route page', async ({ page }) => {
    await page.goto('/routes/ruta-rio-chillan');
    const rideLink = page.locator('.top-nav a.nav-active');
    await expect(rideLink).toHaveAttribute('href', '/routes/');
  });

  test('secondary locale: Ride nav links to translated bike-paths', async ({ page }) => {
    await page.goto('/fr/pistes-cyclables/red-de-ciclovias/ciclovia-avenida-ecuador');
    const rideLink = page.locator('.top-nav a.nav-active');
    await expect(rideLink).toHaveAttribute('href', '/fr/pistes-cyclables/');
  });

  test('Community nav is active on event detail page and links to /calendar', async ({ page }) => {
    await page.goto('/events/2026/demo-ride');
    const communityLink = page.locator('.top-nav a.nav-active');
    // Demo city default locale is es-CL: "Comunidad"
    await expect(communityLink).toContainText('Comunidad');
    await expect(communityLink).toHaveAttribute('href', '/calendar/');
  });
});

test.describe('Bike path detail page (member of network)', () => {
  test('facts table shows length computed from geo file', async ({ page }) => {
    await page.goto('/bike-paths/red-de-ciclovias/ciclovia-avenida-ecuador');
    const factsTable = page.locator('.bike-path-facts-table');
    await expect(factsTable).toBeVisible();
    // 4 OSM way segments totaling ~3.1 km
    await expect(factsTable).toContainText('3.1 km');
  });

  test('facts table shows surface type', async ({ page }) => {
    await page.goto('/bike-paths/red-de-ciclovias/ciclovia-avenida-ecuador');
    const factsTable = page.locator('.bike-path-facts-table');
    await expect(factsTable).toContainText('Pavimentado');
  });

  test('facts table shows separation and lighting', async ({ page }) => {
    await page.goto('/bike-paths/red-de-ciclovias/ciclovia-avenida-ecuador');
    const factsTable = page.locator('.bike-path-facts-table');
    // highway: cycleway → separated from traffic
    await expect(factsTable).toContainText('Separado del tráfico');
    // lit: yes → localized fact string
    await expect(factsTable).toContainText('Iluminado de noche');
  });
});

test.describe('Network pages', () => {
  test('network detail page renders', async ({ page }) => {
    const response = await page.goto('/bike-paths/red-de-ciclovias');
    expect(response?.status()).toBe(200);
    await expect(page.locator('h1')).toContainText('Red de Ciclovías');
  });

  test('network page shows member list with 2 members', async ({ page }) => {
    await page.goto('/bike-paths/red-de-ciclovias');
    const memberList = page.locator('.network-members-list');
    await expect(memberList).toBeVisible();
    await expect(memberList.locator('li')).toHaveCount(2);
  });

  test('network page shows stats in facts table', async ({ page }) => {
    await page.goto('/bike-paths/red-de-ciclovias');
    const facts = page.locator('.bike-path-facts-table');
    await expect(facts).toContainText('8 km');
    await expect(facts).toContainText('Municipalidad');
  });

  test('member detail page renders at nested URL', async ({ page }) => {
    const response = await page.goto('/bike-paths/red-de-ciclovias/ciclovia-avenida-ecuador');
    expect(response?.status()).toBe(200);
    await expect(page.locator('h1')).toContainText('Ciclovía Avenida Ecuador');
  });

  test('member page shows "Part of" badge linking to network', async ({ page }) => {
    await page.goto('/bike-paths/red-de-ciclovias/ciclovia-avenida-ecuador');
    const badge = page.locator('.network-badge');
    await expect(badge).toBeVisible();
    await expect(badge).toContainText('Red de Ciclovías');
    await expect(badge).toHaveAttribute('href', /\/bike-paths\/red-de-ciclovias\/?$/);
  });
});

// Route detail — media gallery, lightbox, downloads, variant permalinks.
// Demo route "ruta-rio-chillan" has 4 photos, 1 video, 1 variant, cached map PNG.
const ROUTE_DETAIL_URL = '/routes/ruta-rio-chillan/';

test.describe('Route detail — photo gallery', () => {
  test('photo filmstrip renders all scored photos', async ({ page }) => {
    await page.goto(ROUTE_DETAIL_URL);
    const photos = page.locator('.photo-gallery .photo-gallery--image');
    await expect(photos).toHaveCount(4);
  });

  test('clicking a photo opens PhotoSwipe lightbox', async ({ page }) => {
    await page.goto(ROUTE_DETAIL_URL);
    const firstPhoto = page.locator('.photo-gallery .photo-gallery--image').first();
    await firstPhoto.click();
    // PhotoSwipe adds .pswp element to the DOM when opened
    await expect(page.locator('.pswp')).toBeAttached({ timeout: 5000 });
  });

  test('photos have data-cropped for PhotoSwipe animation', async ({ page }) => {
    await page.goto(ROUTE_DETAIL_URL);
    const firstPhoto = page.locator('.photo-gallery .photo-gallery--image').first();
    await expect(firstPhoto).toHaveAttribute('data-cropped', 'true');
  });

  test('cover photo click opens lightbox on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(ROUTE_DETAIL_URL);
    await page.waitForLoadState('networkidle');
    const coverPhoto = page.locator('.gallery-cover-photo');
    await expect(coverPhoto).toBeVisible({ timeout: 5000 });
    await coverPhoto.click();
    await expect(page.locator('.pswp')).toBeAttached({ timeout: 5000 });
  });
});

test.describe('Route detail �� video gallery', () => {
  test('video section renders for route with videos', async ({ page }) => {
    await page.goto(ROUTE_DETAIL_URL);
    const videoSection = page.locator('.route-videos');
    await expect(videoSection).toBeVisible();
  });

  test('video autoplays muted', async ({ page }) => {
    await page.goto(ROUTE_DETAIL_URL);
    const video = page.locator('.video-gallery--player video');
    await expect(video).toHaveAttribute('autoplay', '');
    await expect(video).toHaveAttribute('muted', '');
  });

  test('single video has no thumbnail switcher', async ({ page }) => {
    await page.goto(ROUTE_DETAIL_URL);
    const thumbs = page.locator('.video-gallery--thumbs');
    await expect(thumbs).toHaveCount(0);
  });
});

test.describe('Route detail — media show prop', () => {
  test('photo section does not contain video elements', async ({ page }) => {
    await page.goto(ROUTE_DETAIL_URL);
    const photoSection = page.locator('.route-photos');
    await expect(photoSection).toBeVisible();
    // Photos section should only have photo links, no video player
    const videos = photoSection.locator('video');
    await expect(videos).toHaveCount(0);
  });

  test('video section does not contain photo gallery', async ({ page }) => {
    await page.goto(ROUTE_DETAIL_URL);
    const videoSection = page.locator('.route-videos');
    await expect(videoSection).toBeVisible();
    const photoGallery = videoSection.locator('.photo-gallery');
    await expect(photoGallery).toHaveCount(0);
  });
});

test.describe('Route detail — downloads', () => {
  test('Download PNG button appears when map exists', async ({ page }) => {
    await page.goto(ROUTE_DETAIL_URL);
    const pngButton = page.locator('.route-downloads a', { hasText: 'Download PNG' });
    // PNG button is only rendered when generate-maps.ts produced a cached map.
    // In CI the map cache may miss (no GOOGLE_MAPS_STATIC_API_KEY) — skip if absent.
    if (await pngButton.count() === 0) {
      console.warn('No cached map PNG — skipping Download PNG button test');
      test.skip();
    }
    await expect(pngButton).toBeVisible();
    await expect(pngButton).toHaveAttribute('href', /\/maps\/ruta-rio-chillan\/.*map\.png/);
  });

  test('Download GPX button is present', async ({ page }) => {
    await page.goto(ROUTE_DETAIL_URL);
    const gpxButton = page.locator('.route-downloads a', { hasText: 'GPX' }).first();
    await expect(gpxButton).toBeVisible();
    await expect(gpxButton).toHaveAttribute('href', /\.gpx$/);
  });
});

test.describe('Route detail — variant permalink', () => {
  test('variant param in URL selects the variant', async ({ page }) => {
    // Demo city has only one variant (variants-default), so ?variant=variants-default
    // should work without error — the selector reads it and dispatches variant:change
    await page.goto(ROUTE_DETAIL_URL + '?variant=variants-default');
    // Page should load successfully with the variant active
    await expect(page.locator('h1')).toContainText('Ruta Río Chillán');
  });
});

// Translated slug in secondary locale — reproduces production 404 at
// https://ottawabybike.ca/fr/parcours/ottawa-a-plaisance/
//
// Route ID: "ottawa-to-plaisance", French translated slug: "ottawa-a-plaisance".
// Astro only builds /fr/parcours/ottawa-to-plaisance/ (the route ID).
// The translated slug URL must also resolve — currently it relies on
// Cloudflare _redirects 200 rewrites, which don't work in wrangler dev
// and are fragile in production. The fix should make Astro generate pages
// at the translated slug path directly.
test.describe('Route detail — translated slug in secondary locale', () => {
  test('French translated slug URL renders without 404', async ({ page }) => {
    const response = await page.goto('/fr/parcours/ottawa-a-plaisance/');
    expect(response?.status()).toBe(200);
    await expect(page.locator('h1')).toContainText('Ottawa à Plaisance');
  });

  test('default locale route detail uses original slug', async ({ page }) => {
    const response = await page.goto('/routes/ottawa-to-plaisance/');
    expect(response?.status()).toBe(200);
    await expect(page.locator('h1')).toContainText('Ottawa to Plaisance');
  });

  // "Wrong combo" pages redirect to the canonical slug for the locale.
  // Astro.redirect() on prerendered pages emits a meta refresh redirect.
  test('French path with route ID slug redirects to translated slug', async ({ page }) => {
    await page.goto('/fr/parcours/ottawa-to-plaisance/');
    await page.waitForURL('**/fr/parcours/ottawa-a-plaisance/**');
    expect(page.url()).toContain('/fr/parcours/ottawa-a-plaisance/');
  });

  test('default path with translated slug redirects to route ID', async ({ page }) => {
    await page.goto('/routes/ottawa-a-plaisance/');
    await page.waitForURL('**/routes/ottawa-to-plaisance/**');
    expect(page.url()).toContain('/routes/ottawa-to-plaisance/');
  });
});

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

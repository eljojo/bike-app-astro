import { test, expect } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import matter from 'gray-matter';
import { FIXTURE_DIR } from './fixture-setup.ts';
import { seedSession, cleanupSession, loginAs, cleanupCreatedFiles, waitForHydration } from './helpers.ts';

test.describe('Route Creation', () => {
  let token: string;

  test.beforeAll(async () => {
    token = seedSession();
  });

  test.afterAll(() => {
    cleanupSession(token);
  });

  test.beforeEach(() => {
    cleanupCreatedFiles(['demo/routes/test-trail', 'demo/routes/the-royal-oak-centrepointe-to-whiprsnapr-brewing-co']);
  });

  test('URL import input is visible and shows Import button on input', async ({ page }) => {
    await loginAs(page, token);

    await page.goto('/admin/routes/new?full=1');
    await page.waitForLoadState('networkidle');
    await waitForHydration(page);

    // The unified URL import input should be visible
    const urlInput = page.locator('.url-import-input');
    await expect(urlInput).toBeVisible();
    await expect(urlInput).toHaveAttribute('placeholder', /RideWithGPS.*Google Maps/);

    // Import button should NOT be visible when input is empty
    const importButton = page.locator('.url-import button.btn-secondary');
    await expect(importButton).not.toBeVisible();

    // Type a URL — Import button should appear
    await urlInput.fill('https://www.google.com/maps/d/edit?mid=test123');
    await expect(importButton).toBeVisible();
    await expect(importButton).toHaveText('Import');

    // Clear input — button should disappear
    await urlInput.fill('');
    await expect(importButton).not.toBeVisible();
  });

  test('Google Directions URL import shows preview with route name', async ({ page }) => {
    await loginAs(page, token);

    await page.goto('/admin/routes/new?full=1');
    await page.waitForLoadState('networkidle');
    await waitForHydration(page);

    // Paste a full Google Directions URL
    const urlInput = page.locator('.url-import-input');
    await urlInput.fill(
      'https://www.google.com/maps/dir/The+Royal+Oak+-+Centrepointe,+117+Centrepointe+Dr+Unit+105,+Ottawa,+ON+K2G+5X3,+Canada/45.3268492,-75.8054197/Eaton+St,+Ottawa,+ON,+Canada/Whiprsnapr+Brewing+Co.,+14+Bexley+Pl+%23106,+Nepean,+ON+K2H+8W2,+Canada/@45.3347906,-75.8121228,14z/data=!3m1!4b1!4m21!4m20!1m5!1m1!1s0x4cce073d66aaaaab:0xd95fe42b230f3abd!2m2!1d-75.7625!2d45.3430556!1m0!1m5!1m1!1s0x4cce00a16d004239:0x528e8d2b0373771f!2m2!1d-75.8173974!2d45.3264109!1m5!1m1!1s0x4cce00a2800ba81d:0xdadad1e1f95c4a96!2m2!1d-75.819541!2d45.3301965!3e1',
    );

    // Click Import
    const importButton = page.locator('.url-import button.btn-secondary');
    await expect(importButton).toBeVisible();
    await importButton.click();

    // Wait for the route preview to appear (server calls mock Directions API)
    const nameInput = page.locator('#new-route-name');
    await expect(nameInput).toBeVisible({ timeout: 15000 });

    // Route name should be auto-derived from waypoint names
    const nameValue = await nameInput.inputValue();
    expect(nameValue).toContain('Royal Oak');
    expect(nameValue).toContain('Whiprsnapr');

    // Preview map should be visible
    const previewMap = page.locator('.route-preview-map');
    await expect(previewMap).toBeVisible({ timeout: 10000 });

    // Stats should show distance
    const stats = page.locator('.route-preview-stats');
    await expect(stats).toBeVisible();
    await expect(stats).toContainText('km');
  });

  test('route preview shows map and stats after GPX upload', async ({ page }) => {
    await loginAs(page, token);
    await page.goto('/admin/routes/new?full=1');
    await page.waitForLoadState('networkidle');

    // Upload a GPX file
    const gpxInput = page.locator('input[type="file"][accept=".gpx"]');
    const gpxPath = path.join(FIXTURE_DIR, 'demo/routes/carp/main.gpx');
    await gpxInput.setInputFiles(gpxPath);

    // Wait for the map preview to be visible
    const previewMap = page.locator('.route-preview-map');
    await expect(previewMap).toBeVisible({ timeout: 15000 });

    // Stats should be visible
    const stats = page.locator('.route-preview-stats');
    await expect(stats).toBeVisible();
    await expect(stats).toContainText('km');
    await expect(stats).toContainText('gain');

    // Elevation chart should be visible
    const elevationSvg = page.locator('.elevation-svg');
    await expect(elevationSvg).toBeVisible();

    // Name field should still work
    const nameInput = page.locator('#new-route-name');
    await expect(nameInput).toBeVisible();
  });

  test('upload GPX, name route, save, verify commit', async ({ page }) => {
    await loginAs(page, token);

    await page.goto('/admin/routes/new?full=1');
    await page.waitForLoadState('networkidle');
    await waitForHydration(page);

    // Upload a GPX file
    const gpxInput = page.locator('input[type="file"][accept=".gpx"]');
    const gpxPath = path.join(FIXTURE_DIR, 'demo/routes/carp/main.gpx');
    await gpxInput.setInputFiles(gpxPath);

    // Wait for name/slug fields to appear
    const nameInput = page.locator('#new-route-name');
    await expect(nameInput).toBeVisible({ timeout: 5000 });

    // The name should be auto-extracted from the filename
    await expect(nameInput).not.toHaveValue('');

    // Override with a test name
    await nameInput.fill('Test Trail');

    // Click Continue to enter editor phase
    await page.locator('button.btn-primary', { hasText: 'Continue' }).click();

    // Wait for route editor to load
    await waitForHydration(page);

    // Verify we're now in the editor phase (has Save button)
    const saveButton = page.locator('button.btn-primary', { hasText: 'Save' });
    await expect(saveButton).toBeVisible({ timeout: 5000 });

    // Record git HEAD before save
    const headBefore = execSync('git rev-parse HEAD', { cwd: FIXTURE_DIR }).toString().trim();

    // Save the new route
    await saveButton.click();

    // Should redirect to the edit page for the new route
    await page.waitForURL('**/admin/routes/test-trail', { timeout: 10000 });

    // Verify git commit happened
    const headAfter = execSync('git rev-parse HEAD', { cwd: FIXTURE_DIR }).toString().trim();
    expect(headAfter).not.toBe(headBefore);

    // Verify files were created
    const routeDir = path.join(FIXTURE_DIR, 'demo/routes/test-trail');
    expect(fs.existsSync(routeDir)).toBe(true);

    const indexMd = fs.readFileSync(path.join(routeDir, 'index.md'), 'utf-8');
    const { data: fm } = matter(indexMd);
    expect(fm.name).toBe('Test Trail');
    expect(fm.status).toBe('draft');
    expect(fm.variants).toHaveLength(1);

    // GPX file should exist
    expect(fs.existsSync(path.join(routeDir, 'main.gpx'))).toBe(true);
  });
});

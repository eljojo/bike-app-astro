import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { FIXTURE_DIR } from './fixture-setup.ts';
import { seedSession, cleanupSession, loginAs } from './helpers.ts';

test.describe('Photo Parking', () => {
  let token: string;

  test.beforeEach(() => {
    token = seedSession();
  });

  test.afterEach(() => {
    cleanupSession(token);
  });

  test('park a photo via save API and verify parked-photos.yml', async ({ page }) => {
    await loginAs(page, token);
    await page.goto('/admin/routes/carp');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Verify the route has 2 photos initially
    const photoCards = page.locator('.photo-card');
    await expect(photoCards).toHaveCount(2);

    // Remove the second photo from media and park it via API
    // (drag-and-drop with custom dataTransfer is not supported by Playwright)
    const res = await page.evaluate(async () => {
      const response = await fetch('/api/routes/carp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          frontmatter: {
            name: 'Towards Carp',
            tagline: 'Keep going west',
            tags: ['road'],
            status: 'published',
          },
          body: 'Carp is a rural community west of Ottawa. This route follows the Trans Canada Trail through Stittsville and on to Carp along quiet rural roads.',
          media: [
            { key: 'e2e-test-cover-photo-key', caption: 'Test cover photo', cover: true, lat: 45.3485, lng: -75.8154, width: 1200, height: 800 },
          ],
          parkedPhotos: [
            { key: 'e2e-parkable-photo-key', lat: 45.36, lng: -75.83, caption: 'Parkable photo', width: 1000, height: 750 },
          ],
          variants: [
            { name: '2024 Detour', gpx: 'main.gpx', distance_km: 34.3 },
            { name: 'Normal Route', gpx: 'variants/main.gpx', distance_km: 40.8 },
          ],
        }),
      });
      return { status: response.status, body: await response.json() };
    });

    expect(res.status).toBe(200);

    // Verify parked-photos.yml was created
    const parkedPath = path.join(FIXTURE_DIR, 'ottawa', 'parked-photos.yml');
    expect(fs.existsSync(parkedPath)).toBe(true);

    const parked = yaml.load(fs.readFileSync(parkedPath, 'utf-8')) as any[];
    expect(parked).toHaveLength(1);
    expect(parked[0].key).toBe('e2e-parkable-photo-key');
    expect(parked[0].lat).toBe(45.36);
    expect(parked[0].caption).toBe('Parkable photo');

    // Verify media.yml was updated — only cover photo remains
    const mediaPath = path.join(FIXTURE_DIR, 'ottawa', 'routes', 'carp', 'media.yml');
    const media = yaml.load(fs.readFileSync(mediaPath, 'utf-8')) as any[];
    const photoEntries = media.filter((m: any) => m.type === 'photo');
    expect(photoEntries).toHaveLength(1);
    expect(photoEntries[0].key).toBe('e2e-test-cover-photo-key');
  });

  test('un-park a photo by adding it back to a route', async ({ page }) => {
    await loginAs(page, token);

    // First, park a photo
    await page.goto('/admin/routes/carp');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    await page.evaluate(async () => {
      await fetch('/api/routes/carp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          frontmatter: { name: 'Towards Carp', tagline: 'Keep going west', tags: ['road'], status: 'published' },
          body: 'Carp is a rural community west of Ottawa. This route follows the Trans Canada Trail through Stittsville and on to Carp along quiet rural roads.',
          media: [
            { key: 'e2e-test-cover-photo-key', caption: 'Test cover photo', cover: true, lat: 45.3485, lng: -75.8154, width: 1200, height: 800 },
          ],
          parkedPhotos: [
            { key: 'e2e-parkable-photo-key', lat: 45.36, lng: -75.83, caption: 'Parkable photo', width: 1000, height: 750 },
          ],
          variants: [
            { name: '2024 Detour', gpx: 'main.gpx', distance_km: 34.3 },
            { name: 'Normal Route', gpx: 'variants/main.gpx', distance_km: 40.8 },
          ],
        }),
      });
    });

    // Verify photo is parked
    const parkedPath = path.join(FIXTURE_DIR, 'ottawa', 'parked-photos.yml');
    expect(fs.existsSync(parkedPath)).toBe(true);

    // Now reload and add the parked photo back
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    const res = await page.evaluate(async () => {
      const response = await fetch('/api/routes/carp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          frontmatter: { name: 'Towards Carp', tagline: 'Keep going west', tags: ['road'], status: 'published' },
          body: 'Carp is a rural community west of Ottawa. This route follows the Trans Canada Trail through Stittsville and on to Carp along quiet rural roads.',
          media: [
            { key: 'e2e-test-cover-photo-key', caption: 'Test cover photo', cover: true, lat: 45.3485, lng: -75.8154, width: 1200, height: 800 },
            { key: 'e2e-parkable-photo-key', caption: 'Parkable photo', lat: 45.36, lng: -75.83, width: 1000, height: 750 },
          ],
          variants: [
            { name: '2024 Detour', gpx: 'main.gpx', distance_km: 34.3 },
            { name: 'Normal Route', gpx: 'variants/main.gpx', distance_km: 40.8 },
          ],
        }),
      });
      return { status: response.status, body: await response.json() };
    });

    expect(res.status).toBe(200);

    // Verify parked-photos.yml was deleted (all photos un-parked)
    expect(fs.existsSync(parkedPath)).toBe(false);

    // Verify media.yml has both photos back
    const mediaPath = path.join(FIXTURE_DIR, 'ottawa', 'routes', 'carp', 'media.yml');
    const media = yaml.load(fs.readFileSync(mediaPath, 'utf-8')) as any[];
    const photoEntries = media.filter((m: any) => m.type === 'photo');
    expect(photoEntries).toHaveLength(2);
  });
});

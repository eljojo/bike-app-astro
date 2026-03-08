import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { FIXTURE_DIR } from './fixture-setup.ts';
import { seedSession, cleanupSession, loginAs, clearContentEdits, restoreFixtureFiles, deleteFixtureFile } from './helpers.ts';

test.describe('Photo Parking', () => {
  let token: string;

  test.beforeAll(() => {
    token = seedSession();
  });

  test.afterAll(() => {
    cleanupSession(token);
  });

  test.beforeEach(() => {
    clearContentEdits('routes', 'route-park-a');
    clearContentEdits('routes', 'route-park-b');
    clearContentEdits('parked-photos', '__global');
    // Restore modified fixture files so retries see original state
    restoreFixtureFiles([
      'demo/routes/route-park-a/media.yml',
      'demo/routes/route-park-b/media.yml',
    ]);
    deleteFixtureFile('demo/parked-photos.yml');
  });

  test('park a photo via save API and verify parked-photos.yml', async ({ page }) => {
    await loginAs(page, token);
    await page.goto('/admin/routes/route-park-a');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Verify the route has 2 photos initially
    const photoCards = page.locator('.photo-card');
    await expect(photoCards).toHaveCount(2);

    // Remove the second photo from media and park it via API
    const res = await page.evaluate(async () => {
      const response = await fetch('/api/routes/route-park-a', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          frontmatter: {
            name: 'Park Test A',
            tagline: 'Keep going west',
            tags: ['road'],
            status: 'published',
          },
          body: 'Carp is a rural community west of the city. This route follows the Trans Canada Trail through Stittsville and on to Carp along quiet rural roads.',
          media: [
            { key: 'park-a-cover-key', caption: 'Test cover photo', cover: true, lat: 45.3485, lng: -75.8154, width: 1200, height: 800 },
          ],
          parkedPhotos: [
            { key: 'park-a-parkable-key', lat: 45.36, lng: -75.83, caption: 'Parkable photo A', width: 1000, height: 750 },
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

    // Verify parked-photos.yml was created with our specific key
    const parkedPath = path.join(FIXTURE_DIR, 'demo', 'parked-photos.yml');
    expect(fs.existsSync(parkedPath)).toBe(true);

    const parked = yaml.load(fs.readFileSync(parkedPath, 'utf-8')) as any[];
    expect(parked.some((p: any) => p.key === 'park-a-parkable-key')).toBe(true);
    const parkedEntry = parked.find((p: any) => p.key === 'park-a-parkable-key');
    expect(parkedEntry.lat).toBe(45.36);
    expect(parkedEntry.caption).toBe('Parkable photo A');

    // Verify media.yml was updated — only cover photo remains
    const mediaPath = path.join(FIXTURE_DIR, 'demo', 'routes', 'route-park-a', 'media.yml');
    const media = yaml.load(fs.readFileSync(mediaPath, 'utf-8')) as any[];
    const photoEntries = media.filter((m: any) => m.type === 'photo');
    expect(photoEntries).toHaveLength(1);
    expect(photoEntries[0].key).toBe('park-a-cover-key');
  });

  test('un-park a photo by adding it back to a route', async ({ page }) => {
    await loginAs(page, token);

    // First, park a photo from route-park-b
    await page.goto('/admin/routes/route-park-b');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    await page.evaluate(async () => {
      await fetch('/api/routes/route-park-b', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          frontmatter: { name: 'Park Test B', tagline: 'Keep going west', tags: ['road'], status: 'published' },
          body: 'Carp is a rural community west of the city. This route follows the Trans Canada Trail through Stittsville and on to Carp along quiet rural roads.',
          media: [
            { key: 'park-b-cover-key', caption: 'Test cover photo', cover: true, lat: 45.3485, lng: -75.8154, width: 1200, height: 800 },
          ],
          parkedPhotos: [
            { key: 'park-b-parkable-key', lat: 45.36, lng: -75.83, caption: 'Parkable photo B', width: 1000, height: 750 },
          ],
          variants: [
            { name: '2024 Detour', gpx: 'main.gpx', distance_km: 34.3 },
            { name: 'Normal Route', gpx: 'variants/main.gpx', distance_km: 40.8 },
          ],
        }),
      });
    });

    // Verify photo is parked
    const parkedPath = path.join(FIXTURE_DIR, 'demo', 'parked-photos.yml');
    expect(fs.existsSync(parkedPath)).toBe(true);
    const parkedBefore = yaml.load(fs.readFileSync(parkedPath, 'utf-8')) as any[];
    expect(parkedBefore.some((p: any) => p.key === 'park-b-parkable-key')).toBe(true);

    // Now reload and add the parked photo back
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    const res = await page.evaluate(async () => {
      const response = await fetch('/api/routes/route-park-b', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          frontmatter: { name: 'Park Test B', tagline: 'Keep going west', tags: ['road'], status: 'published' },
          body: 'Carp is a rural community west of the city. This route follows the Trans Canada Trail through Stittsville and on to Carp along quiet rural roads.',
          media: [
            { key: 'park-b-cover-key', caption: 'Test cover photo', cover: true, lat: 45.3485, lng: -75.8154, width: 1200, height: 800 },
            { key: 'park-b-parkable-key', caption: 'Parkable photo B', lat: 45.36, lng: -75.83, width: 1000, height: 750 },
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

    // Verify park-b-parkable-key is no longer parked
    if (fs.existsSync(parkedPath)) {
      const parkedAfter = yaml.load(fs.readFileSync(parkedPath, 'utf-8')) as any[];
      expect(parkedAfter.some((p: any) => p.key === 'park-b-parkable-key')).toBe(false);
    }

    // Verify media.yml has both photos back
    const mediaPath = path.join(FIXTURE_DIR, 'demo', 'routes', 'route-park-b', 'media.yml');
    const media = yaml.load(fs.readFileSync(mediaPath, 'utf-8')) as any[];
    const photoEntries = media.filter((m: any) => m.type === 'photo');
    expect(photoEntries).toHaveLength(2);
  });
});

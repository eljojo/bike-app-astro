/**
 * E2E tests for D1 cache verification, conflict detection, and permission stripping.
 *
 * These tests verify integration behavior that unit tests can't catch because
 * they mock the database and git service. Specifically:
 *
 * 1. D1 cache is updated after save (content_edits table has correct data + SHA)
 * 2. Conflict detection returns 409 when content changed between load and save
 * 3. Permission stripping prevents guests from setting status field
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import matter from 'gray-matter';
import { FIXTURE_DIR } from './fixture-setup.ts';
import {
  seedSession, cleanupSession, loginAs,
  clearContentEdits, getContentEdit, restoreFixtureFiles,
} from './helpers.ts';

/** Build a standard route save payload. */
function routePayload(overrides: Record<string, unknown> = {}) {
  return {
    frontmatter: {
      name: 'Cache Test Route',
      tagline: overrides.tagline ?? 'Original tagline',
      tags: ['road'],
      status: 'published',
      ...overrides.frontmatter as Record<string, unknown> | undefined,
    },
    body: (overrides.body as string) ?? 'Cache test route body.',
    media: [
      { key: 'cache-cover-key', type: 'photo', cover: true, width: 1200, height: 800 },
      { key: 'cache-extra-key', type: 'photo', width: 1000, height: 750 },
    ],
    variants: [
      { name: '2024 Detour', gpx: 'main.gpx', distance_km: 34.3, strava_url: 'https://www.strava.com/activities/11458503483' },
      { name: 'Normal Route', gpx: 'variants/main.gpx', distance_km: 40.8, strava_url: 'https://www.strava.com/activities/7907456752' },
    ],
    ...(overrides.contentHash !== undefined ? { contentHash: overrides.contentHash } : {}),
  };
}

/** POST to the route save API and return the response. */
async function saveRoute(
  page: import('@playwright/test').Page,
  slug: string,
  payload: ReturnType<typeof routePayload>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  return page.evaluate(async ({ slug, payload }) => {
    const res = await fetch(`/api/routes/${slug}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return { status: res.status, body: await res.json() };
  }, { slug, payload });
}

// ---------------------------------------------------------------------------
// 1. D1 Cache Verification
// ---------------------------------------------------------------------------

test.describe('D1 Cache — verified after save', () => {
  let token: string;

  test.beforeAll(() => { token = seedSession(); });
  test.afterAll(() => { cleanupSession(token); });

  test.beforeEach(() => {
    clearContentEdits('routes', 'route-cache');
    restoreFixtureFiles([
      'demo/routes/route-cache/index.md',
      'demo/routes/route-cache/media.yml',
    ]);
  });

  test('save populates content_edits with correct data and githubSha', async ({ page }) => {
    await loginAs(page, token);
    await page.goto('/admin/routes/route-cache');
    await page.waitForLoadState('networkidle');

    // Verify no cache entry exists before save
    const before = getContentEdit('routes', 'route-cache');
    expect(before).toBeNull();

    const testTagline = `Cache verify ${Date.now()}`;
    const payload = routePayload({ tagline: testTagline });
    const response = await saveRoute(page, 'route-cache', payload);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.contentHash).toBeDefined();

    // THE CRITICAL ASSERTION: D1 cache must be populated
    const cached = getContentEdit('routes', 'route-cache');
    expect(cached).not.toBeNull();
    expect(cached!.githubSha).toBeTruthy();
    expect(cached!.updatedAt).toBeTruthy();

    // Verify cached data contains the saved tagline
    const cachedData = JSON.parse(cached!.data);
    expect(cachedData.tagline).toBe(testTagline);
    expect(cachedData.name).toBe('Cache Test Route');
    expect(cachedData.status).toBe('published');

    // Verify the githubSha matches the actual git blob SHA of the committed file
    const indexPath = path.join(FIXTURE_DIR, 'demo/routes/route-cache/index.md');
    const fileContent = fs.readFileSync(indexPath, 'utf-8');
    // Git blob SHA = SHA1("blob <size>\0<content>")
    const { createHash } = await import('node:crypto');
    const blobHeader = `blob ${Buffer.byteLength(fileContent, 'utf-8')}\0`;
    const expectedSha = createHash('sha1')
      .update(blobHeader)
      .update(fileContent)
      .digest('hex');
    expect(cached!.githubSha).toBe(expectedSha);
  });

  test('second save updates the cache entry (not just inserts)', async ({ page }) => {
    await loginAs(page, token);
    await page.goto('/admin/routes/route-cache');
    await page.waitForLoadState('networkidle');

    // First save
    const payload1 = routePayload({ tagline: 'First save' });
    const res1 = await saveRoute(page, 'route-cache', payload1);
    expect(res1.status).toBe(200);

    const afterFirst = getContentEdit('routes', 'route-cache');
    expect(afterFirst).not.toBeNull();
    const firstSha = afterFirst!.githubSha;

    // Second save with different tagline
    const payload2 = routePayload({ tagline: 'Second save' });
    const res2 = await saveRoute(page, 'route-cache', payload2);
    expect(res2.status).toBe(200);

    const afterSecond = getContentEdit('routes', 'route-cache');
    expect(afterSecond).not.toBeNull();

    // SHA must change because content changed
    expect(afterSecond!.githubSha).not.toBe(firstSha);

    // Cached data must reflect second save
    const cachedData = JSON.parse(afterSecond!.data);
    expect(cachedData.tagline).toBe('Second save');
  });
});

// ---------------------------------------------------------------------------
// 2. Conflict Detection
// ---------------------------------------------------------------------------

test.describe('Conflict Detection — 409 on stale content', () => {
  let token: string;

  test.beforeAll(() => { token = seedSession(); });
  test.afterAll(() => { cleanupSession(token); });

  test.beforeEach(() => {
    clearContentEdits('routes', 'route-cache');
    restoreFixtureFiles([
      'demo/routes/route-cache/index.md',
      'demo/routes/route-cache/media.yml',
    ]);
  });

  test('second save with stale SHA gets 409 conflict', async ({ page }) => {
    await loginAs(page, token);
    await page.goto('/admin/routes/route-cache');
    await page.waitForLoadState('networkidle');

    // First save — establishes the D1 cache entry with a githubSha
    const payload1 = routePayload({ tagline: 'Editor A saves first' });
    const res1 = await saveRoute(page, 'route-cache', payload1);
    expect(res1.status).toBe(200);

    const afterFirst = getContentEdit('routes', 'route-cache');
    expect(afterFirst).not.toBeNull();

    // Simulate a second editor modifying the file directly on disk
    // (as if they committed via GitHub while editor A was still working).
    // This changes the git blob SHA without updating D1.
    const indexPath = path.join(FIXTURE_DIR, 'demo/routes/route-cache/index.md');
    const currentContent = fs.readFileSync(indexPath, 'utf-8');
    const { data: fm, content: body } = matter(currentContent);
    fm.tagline = 'Changed by another editor on GitHub';
    const modifiedContent = matter.stringify(body, fm);
    fs.writeFileSync(indexPath, modifiedContent, 'utf-8');
    // Commit the change so LocalGitService sees the new SHA
    execSync('git add -A && git commit -m "simulate concurrent edit"', {
      cwd: FIXTURE_DIR, stdio: 'pipe',
    });

    // Now the D1 cache has stale SHA (from first save) but git has a new SHA.
    // A save from the original editor should detect the conflict.
    const payload2 = routePayload({ tagline: 'Editor A tries to save again' });
    const res2 = await saveRoute(page, 'route-cache', payload2);

    // THE CRITICAL ASSERTION: must get 409 Conflict
    expect(res2.status).toBe(409);
    expect(res2.body.conflict).toBe(true);
    expect(res2.body.error).toContain('modified');

    // Verify the file on disk was NOT overwritten (the stale save was rejected)
    const afterConflict = fs.readFileSync(indexPath, 'utf-8');
    expect(afterConflict).toContain('Changed by another editor on GitHub');

    // Verify D1 cache was refreshed with the current git state (not the stale data)
    const refreshedCache = getContentEdit('routes', 'route-cache');
    expect(refreshedCache).not.toBeNull();
    const refreshedData = JSON.parse(refreshedCache!.data);
    expect(refreshedData.tagline).toBe('Changed by another editor on GitHub');
  });
});

// ---------------------------------------------------------------------------
// 3. Permission Stripping
// ---------------------------------------------------------------------------

test.describe('Permission Stripping — guest cannot set status', () => {
  let adminToken: string;
  let guestToken: string;

  test.beforeAll(() => {
    adminToken = seedSession({ role: 'admin', username: 'Perms Admin', email: 'perms-admin@test.local' });
    guestToken = seedSession({ role: 'guest', username: 'perms-guest', email: null });
  });

  test.afterAll(() => {
    cleanupSession(adminToken);
    cleanupSession(guestToken);
  });

  test.beforeEach(() => {
    clearContentEdits('routes', 'route-perms');
    restoreFixtureFiles([
      'demo/routes/route-perms/index.md',
      'demo/routes/route-perms/media.yml',
    ]);
  });

  test('guest save strips status field — cannot change published to draft', async ({ page }) => {
    await loginAs(page, guestToken);
    await page.goto('/admin/routes/route-perms');
    await page.waitForLoadState('networkidle');

    // Guest tries to save with status: draft (attempting to unpublish)
    const payload = routePayload({
      frontmatter: {
        name: 'Permissions Test Route',
        tagline: 'Guest edited this',
        tags: ['road'],
        status: 'draft',  // Guest should NOT be able to set this
      },
    });
    const response = await saveRoute(page, 'route-perms', payload);

    expect(response.status).toBe(200);

    // Verify the file was saved but status was NOT changed to draft
    const indexPath = path.join(FIXTURE_DIR, 'demo/routes/route-perms/index.md');
    const saved = fs.readFileSync(indexPath, 'utf-8');
    const { data: fm } = matter(saved);

    // THE CRITICAL ASSERTION: status must remain 'published' despite guest requesting 'draft'
    expect(fm.status).toBe('published');

    // Guest's tagline change should have been applied
    expect(fm.tagline).toBe('Guest edited this');

    // Verify D1 cache also has the correct (unstripped) status
    const cached = getContentEdit('routes', 'route-perms');
    expect(cached).not.toBeNull();
    const cachedData = JSON.parse(cached!.data);
    expect(cachedData.status).toBe('published');
  });

  test('admin save preserves status field — can change published to draft', async ({ page }) => {
    await loginAs(page, adminToken);
    await page.goto('/admin/routes/route-perms');
    await page.waitForLoadState('networkidle');

    // Admin saves with status: draft
    const payload = routePayload({
      frontmatter: {
        name: 'Permissions Test Route',
        tagline: 'Admin changed status',
        tags: ['road'],
        status: 'draft',
      },
    });
    const response = await saveRoute(page, 'route-perms', payload);

    expect(response.status).toBe(200);

    // Admin's status change should be preserved
    const indexPath = path.join(FIXTURE_DIR, 'demo/routes/route-perms/index.md');
    const saved = fs.readFileSync(indexPath, 'utf-8');
    const { data: fm } = matter(saved);

    expect(fm.status).toBe('draft');
    expect(fm.tagline).toBe('Admin changed status');
  });
});

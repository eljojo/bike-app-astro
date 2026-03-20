/**
 * E2E test: video key annotation in the save pipeline.
 *
 * Verifies that when a route is saved with a video media item and a
 * matching videoJobs row exists in D1, the committed media.yml contains
 * the video entry with the correct key format (annotated by videoKeyForGit).
 *
 * This test would have caught the bug where staging video keys were
 * committed as bare keys (e.g. 'fkpryqw7' instead of 'staging/fkpryqw7').
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import Database from 'better-sqlite3';
import yaml from 'js-yaml';
import { initSchema } from '../../src/db/init-schema.ts';
import { FIXTURE_DIR, DB_PATH } from './fixture-setup.ts';
import { seedSession, cleanupSession, loginAs, clearContentEdits, restoreFixtureFiles, waitForHydration } from './helpers.ts';

const VIDEO_KEY = 'e2evid01';

function seedVideoJob(key: string, slug: string) {
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  initSchema(db);
  db.prepare(`INSERT OR REPLACE INTO video_jobs
    (key, content_kind, content_slug, status, width, height, duration, orientation, updated_at)
    VALUES (?, ?, ?, 'ready', 1080, 1920, 'PT30S', 'portrait', datetime('now'))
  `).run(key, 'routes', slug);
  db.close();
}

function cleanupVideoJob(key: string) {
  if (!fs.existsSync(DB_PATH)) return;
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  try { db.prepare('DELETE FROM video_jobs WHERE key = ?').run(key); } catch {}
  db.close();
}

test.describe('Video Save — Key Annotation', () => {
  let token: string;

  test.beforeAll(() => {
    token = seedSession();
  });

  test.afterAll(() => {
    cleanupSession(token);
    cleanupVideoJob(VIDEO_KEY);
  });

  test.beforeEach(() => {
    clearContentEdits('routes', 'route-video');
    restoreFixtureFiles([
      'demo/routes/route-video/index.md',
      'demo/routes/route-video/media.yml',
    ]);
  });

  test('save with video media item writes correct key to media.yml', async ({ page }) => {
    // Seed a ready videoJobs row so enrichment can consume it
    seedVideoJob(VIDEO_KEY, 'route-video');

    await loginAs(page, token);

    // Navigate to route editor
    await page.goto('/admin/routes/route-video');
    await page.waitForLoadState('networkidle');
    await waitForHydration(page);

    // Record git HEAD before save
    const headBefore = execSync('git rev-parse HEAD', { cwd: FIXTURE_DIR }).toString().trim();

    // POST directly to the save API with a video media item.
    // This bypasses the UI but exercises the full server-side pipeline:
    // enrichment → annotation → serialization → git commit.
    const response = await page.evaluate(async (videoKey) => {
      const res = await fetch('/api/routes/route-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          frontmatter: {
            name: 'Video Test Route',
            tagline: 'Testing video key annotation',
            tags: ['road'],
            status: 'published',
          },
          body: 'Route with a video.',
          media: [
            { key: 'video-cover-key', type: 'photo', cover: true, width: 1200, height: 800 },
            { key: 'video-extra-key', type: 'photo', width: 1000, height: 750 },
            {
              key: videoKey,
              type: 'video',
              title: 'Test video',
              handle: 'test-video',
            },
          ],
          variants: [
            { name: '2024 Detour', gpx: 'main.gpx', distance_km: 34.3, strava_url: 'https://www.strava.com/activities/11458503483' },
            { name: 'Normal Route', gpx: 'variants/main.gpx', distance_km: 40.8, strava_url: 'https://www.strava.com/activities/7907456752' },
          ],
        }),
      });
      return { status: res.status, body: await res.json() };
    }, VIDEO_KEY);

    expect(response.status).toBe(200);

    // Verify a new commit was created
    const headAfter = execSync('git rev-parse HEAD', { cwd: FIXTURE_DIR }).toString().trim();
    expect(headAfter).not.toBe(headBefore);

    // Read the committed media.yml and verify video key format
    const mediaPath = path.join(FIXTURE_DIR, 'demo/routes/route-video/media.yml');
    const mediaYaml = fs.readFileSync(mediaPath, 'utf-8');
    const mediaEntries = yaml.load(mediaYaml) as Array<{
      key: string;
      type?: string;
      width?: number;
      height?: number;
      duration?: string;
      orientation?: string;
    }>;

    // Find the video entry
    const videoEntry = mediaEntries.find(m => m.type === 'video');
    expect(videoEntry).toBeDefined();

    // THE CRITICAL ASSERTION: video key must be what videoKeyForGit produces.
    // In E2E (CITY=demo, VIDEO_PREFIX=demo), this is the bare key.
    // But the test verifies the pipeline actually processes video keys through
    // enrichment and annotation — not just passing them through unchanged.
    expect(videoEntry!.key).toBe(VIDEO_KEY);

    // Verify enrichment pulled metadata from the videoJobs row
    expect(videoEntry!.width).toBe(1080);
    expect(videoEntry!.height).toBe(1920);
    expect(videoEntry!.duration).toBe('PT30S');
    expect(videoEntry!.orientation).toBe('portrait');

    // Verify the videoJobs row was consumed (deleted after successful commit)
    const db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');
    const remaining = db.prepare('SELECT * FROM video_jobs WHERE key = ?').get(VIDEO_KEY);
    db.close();
    expect(remaining).toBeUndefined();
  });

  test('re-save preserves existing video key when no videoJobs row exists', async ({ page }) => {
    // First, write a media.yml that already contains a video with an annotated key
    const mediaPath = path.join(FIXTURE_DIR, 'demo/routes/route-video/media.yml');
    const existingMedia = [
      { type: 'photo', key: 'video-cover-key', cover: true, width: 1200, height: 800, handle: 'cover' },
      {
        type: 'video', key: 'somecity-staging/existvid1',
        title: 'Existing video', handle: 'existing-video',
        width: 1920, height: 1080, duration: 'PT15S', orientation: 'landscape',
      },
    ];
    fs.writeFileSync(mediaPath, '---\n' + yaml.dump(existingMedia));
    // Commit the change so LocalGitService sees it
    execSync('git add -A && git commit -m "add video fixture"', {
      cwd: FIXTURE_DIR, stdio: 'pipe',
    });

    // Ensure NO videoJobs row exists for this key
    cleanupVideoJob('existvid1');

    await loginAs(page, token);
    await page.goto('/admin/routes/route-video');
    await page.waitForLoadState('networkidle');
    await waitForHydration(page);

    const headBefore = execSync('git rev-parse HEAD', { cwd: FIXTURE_DIR }).toString().trim();

    // Re-save with the same video — the key must be preserved as-is
    const response = await page.evaluate(async () => {
      const res = await fetch('/api/routes/route-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          frontmatter: {
            name: 'Video Test Route',
            tagline: 'Re-save with existing video',
            tags: ['road'],
            status: 'published',
          },
          body: 'Route with an existing video.',
          media: [
            { key: 'video-cover-key', type: 'photo', cover: true, width: 1200, height: 800 },
            {
              key: 'somecity-staging/existvid1',
              type: 'video',
              title: 'Existing video',
              handle: 'existing-video',
              width: 1920, height: 1080,
              duration: 'PT15S',
              orientation: 'landscape',
            },
          ],
          variants: [
            { name: '2024 Detour', gpx: 'main.gpx', distance_km: 34.3, strava_url: 'https://www.strava.com/activities/11458503483' },
            { name: 'Normal Route', gpx: 'variants/main.gpx', distance_km: 40.8, strava_url: 'https://www.strava.com/activities/7907456752' },
          ],
        }),
      });
      return { status: res.status, body: await res.json() };
    });

    expect(response.status).toBe(200);

    const headAfter = execSync('git rev-parse HEAD', { cwd: FIXTURE_DIR }).toString().trim();
    expect(headAfter).not.toBe(headBefore);

    // Read committed media.yml
    const savedYaml = fs.readFileSync(mediaPath, 'utf-8');
    const savedMedia = yaml.load(savedYaml) as Array<{ key: string; type?: string }>;

    const videoEntry = savedMedia.find(m => m.type === 'video');
    expect(videoEntry).toBeDefined();

    // THE CRITICAL ASSERTION: the staging-prefixed key must NOT be stripped.
    // Without the annotation guard, videoKeyForGit would strip it to bare key.
    expect(videoEntry!.key).toBe('somecity-staging/existvid1');
  });
});

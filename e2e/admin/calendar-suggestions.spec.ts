import { test, expect } from '@playwright/test';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { DB_PATH } from './fixture-setup.ts';
import {
  seedSession,
  cleanupSession,
  loginAs,
  waitForHydration,
} from './helpers.ts';

const ORG_SLUG = 'e2e-calendar-club';
const ICS_URL = 'https://example.test/e2e-calendar.ics';

const ONEOFF_UID = 'e2e-oneoff@example.com';
const SERIES_UID = 'e2e-series@example.com';

// Local filesystem adapter for the calendar feed cache writes to `.data/calendar-feed-cache/`
// (matching src/lib/env/env.adapter-local.ts's LOCAL_CALENDAR_FEED_CACHE_DIR). The E2E test
// seeds the adapter directly by creating the same on-disk files the adapter would.
const FEED_CACHE_DIR = path.resolve(path.dirname(DB_PATH), 'calendar-feed-cache');

function feedDataPath(slug: string): string {
  // Mirrors sanitization in feed-cache.adapter-local.ts.
  return path.join(FEED_CACHE_DIR, `${slug.replace(/[^a-zA-Z0-9._\-]/g, '_')}.json`);
}
function feedMetaPath(slug: string): string {
  return feedDataPath(slug) + '.meta';
}

function openDb(): InstanceType<typeof Database> {
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  return db;
}

/** Return a date that is `offsetDays` from today as an ISO datetime string. */
function futureIso(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString();
}

/** Return a date that is `offsetDays` from today as a YYYY-MM-DD string. */
function futureDate(offsetDays: number): string {
  return futureIso(offsetDays).slice(0, 10);
}

function seedFeedCache() {
  // Feed cache now lives in the filesystem adapter (production uses KV). Seed by writing
  // the same `<slug>.json` + `<slug>.json.meta` files the local adapter reads.
  fs.mkdirSync(FEED_CACHE_DIR, { recursive: true });
  const feed = {
    fetched_at: new Date().toISOString(),
    source_url: ICS_URL,
    events: [
      {
        uid: ONEOFF_UID,
        summary: 'E2E One-off Ride',
        start: futureIso(30),
        end: futureIso(30),
        location: 'Test Park',
      },
      {
        uid: SERIES_UID,
        summary: 'E2E Weekly Ride',
        start: futureIso(7),
        series: {
          kind: 'recurrence',
          recurrence: 'weekly',
          recurrence_day: 'monday',
          season_start: futureDate(7),
          season_end: futureDate(150),
        },
      },
    ],
  };
  fs.writeFileSync(feedDataPath(ORG_SLUG), JSON.stringify({ source_url: ICS_URL, feed }));
  fs.writeFileSync(feedMetaPath(ORG_SLUG), JSON.stringify({ expires_at: Date.now() + 3600_000 }));
}

function clearFeedCache() {
  // Remove the filesystem feed-cache entry for our test organizer.
  try { fs.unlinkSync(feedDataPath(ORG_SLUG)); } catch { /* ignore — fresh run */ }
  try { fs.unlinkSync(feedMetaPath(ORG_SLUG)); } catch { /* ignore */ }

  // Clear dismissals for this test's organizer + UIDs. The PK is
  // `(city, organizer_slug, uid)`; we scope deletes by organizer to avoid
  // wiping unrelated dismissals from other suites that may share the file.
  const db = openDb();
  try {
    const stmt = db.prepare('DELETE FROM calendar_suggestion_dismissals WHERE organizer_slug = ? AND uid = ?');
    stmt.run(ORG_SLUG, ONEOFF_UID);
    stmt.run(ORG_SLUG, SERIES_UID);
  } finally {
    db.close();
  }
}

test.describe('Calendar suggestions', () => {
  let token: string;

  test.beforeAll(() => {
    token = seedSession({ role: 'admin' });
  });

  test.afterAll(() => {
    cleanupSession(token);
  });

  test.beforeEach(() => {
    clearFeedCache();
    seedFeedCache();
  });

  test('admin sees one-off and series suggestions', async ({ page }) => {
    await loginAs(page, token);
    await page.goto('/admin/events');
    await waitForHydration(page);

    // Wait for the suggestions fetch to land.
    await expect(page.locator('.admin-sidebar-heading', { hasText: 'Suggestions' })).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.suggestion-item', { hasText: 'E2E One-off Ride' })).toBeVisible();
    await expect(page.locator('.suggestion-item', { hasText: 'E2E Weekly Ride' })).toBeVisible();
  });

  test('clicking a one-off lands on the prefilled new-event form', async ({ page }) => {
    await loginAs(page, token);
    await page.goto('/admin/events');
    await waitForHydration(page);

    await expect(page.locator('.suggestion-item', { hasText: 'E2E One-off Ride' })).toBeVisible({ timeout: 10000 });
    await page.locator('.suggestion-item', { hasText: 'E2E One-off Ride' }).locator('a').click();
    await expect(page).toHaveURL(new RegExp(`/admin/events/new\\?from_feed=${ORG_SLUG}&uid=`));
    await waitForHydration(page);
    await expect(page.locator('#event-name')).toHaveValue('E2E One-off Ride');
    // Date is computed dynamically (30 days from test run) — just verify it's populated.
    await expect(page.locator('#event-start-date')).not.toHaveValue('');
  });

  test('dismissing a suggestion removes it and persists across reload', async ({ page }) => {
    await loginAs(page, token);
    await page.goto('/admin/events');
    await waitForHydration(page);

    await expect(page.locator('.suggestion-item', { hasText: 'E2E Weekly Ride' })).toBeVisible({ timeout: 10000 });

    const item = page.locator('.suggestion-item', { hasText: 'E2E Weekly Ride' });
    await item.locator('.suggestion-dismiss').click();
    await expect(item).toHaveCount(0);

    // Reload — still dismissed.
    await page.reload();
    await waitForHydration(page);
    await expect(page.locator('.suggestion-item', { hasText: 'E2E Weekly Ride' })).toHaveCount(0);
    // But the one-off is still there.
    await expect(page.locator('.suggestion-item', { hasText: 'E2E One-off Ride' })).toBeVisible();
  });
});

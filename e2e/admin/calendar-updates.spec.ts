/**
 * E2E spec: calendar review-update workflow
 *
 * Tests the full loop:
 *   snapshot seeded (V1) + feed updated (V2) →
 *   sidebar shows review row →
 *   review page renders diff →
 *   Apply → snapshot advances → row disappears
 *
 * Fixture dependency: `calendar-review-test.md` in fixture-setup.ts
 * (event with ics_uid = 'e2e-review-oneoff@example.com', organizer = 'e2e-calendar-club').
 */
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
const REVIEW_UID = 'e2e-review-oneoff@example.com';
// Event ID matches the filename: events/2099/calendar-review-test.md → 2099/calendar-review-test
const EVENT_ID = '2099/calendar-review-test';

// Feed cache lives in the filesystem adapter (mirrors calendar-suggestions.spec.ts).
const FEED_CACHE_DIR = path.resolve(path.dirname(DB_PATH), 'calendar-feed-cache');

function feedDataPath(slug: string): string {
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

/**
 * Write a feed cache entry for the organizer.
 * `location` controls what the upstream VEVENT shows.
 */
function seedFeedCache(location: string) {
  fs.mkdirSync(FEED_CACHE_DIR, { recursive: true });
  const feed = {
    fetched_at: new Date().toISOString(),
    source_url: ICS_URL,
    events: [
      {
        uid: REVIEW_UID,
        summary: 'E2E Review Test Ride',
        // Dates far in the future (2099) per AGENTS.md — avoids isPastEvent() filtering.
        start: '2099-08-20T09:00:00',
        end:   '2099-08-20T12:00:00',
        location,
      },
    ],
  };
  fs.writeFileSync(feedDataPath(ORG_SLUG), JSON.stringify({ source_url: ICS_URL, feed }));
  // Set expires_at in the past so the build path re-fetches — or far in the
  // future so the cached version is used. We want the cache to be valid so
  // the server reads our seeded data without hitting the external URL.
  fs.writeFileSync(feedMetaPath(ORG_SLUG), JSON.stringify({ expires_at: Date.now() + 3_600_000 }));
}

/**
 * Seed a `calendar_event_snapshots` row for our test event.
 * The snapshot represents "what the admin last accepted" (V1).
 */
function seedSnapshot(location: string) {
  const db = openDb();
  try {
    const snapshotVEvent = {
      uid: REVIEW_UID,
      summary: 'E2E Review Test Ride',
      start: '2099-08-20T09:00:00',
      end:   '2099-08-20T12:00:00',
      location,
    };
    db.prepare(`
      INSERT OR REPLACE INTO calendar_event_snapshots
        (city, organizer_slug, uid, snapshot_json, snapshotted_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      'demo',
      ORG_SLUG,
      REVIEW_UID,
      JSON.stringify(snapshotVEvent),
      new Date().toISOString(),
      '2099-12-31',  // expires far in the future — stays valid for the test
    );
  } finally {
    db.close();
  }
}

/** Remove feed cache + snapshot seeded by this spec. */
function cleanup() {
  // Feed cache
  try { fs.unlinkSync(feedDataPath(ORG_SLUG)); } catch { /* not present */ }
  try { fs.unlinkSync(feedMetaPath(ORG_SLUG)); } catch { /* not present */ }

  // Snapshot
  const db = openDb();
  try {
    db.prepare(
      'DELETE FROM calendar_event_snapshots WHERE city = ? AND organizer_slug = ? AND uid = ?'
    ).run('demo', ORG_SLUG, REVIEW_UID);

    // Also clear any dismissals written for this uid by the suite
    db.prepare(
      'DELETE FROM calendar_suggestion_dismissals WHERE organizer_slug = ? AND uid = ?'
    ).run(ORG_SLUG, REVIEW_UID);
  } catch {
    // Table may not exist yet on first run before the server initializes the schema
  } finally {
    db.close();
  }
}

test.describe('Calendar review-update workflow', () => {
  let token: string;

  test.beforeAll(() => {
    token = seedSession({ role: 'admin' });
  });

  test.afterAll(() => {
    cleanupSession(token);
  });

  test.beforeEach(() => {
    cleanup();
  });

  test('Scenario 1: location change shows review row → review page → Apply clears row', async ({ page }) => {
    // --- Setup ---
    // V1 snapshot: location = 'Location A' (what was already accepted)
    seedSnapshot('Location A');
    // V2 feed: location = 'Location B' (upstream changed it)
    seedFeedCache('Location B');

    // --- Step 1: sidebar shows review row ---
    await loginAs(page, token);
    await page.goto('/admin/events');
    await waitForHydration(page);

    // The Suggestions component fetches /api/admin/calendar-suggestions which diffs
    // V2 feed against the V1 snapshot → review row with "location changed".
    await expect(
      page.locator('.suggestion-item', { hasText: 'E2E Review Test Ride' })
    ).toBeVisible({ timeout: 15_000 });

    // The meta text should mention "location changed"
    const reviewItem = page.locator('.suggestion-item', { hasText: 'E2E Review Test Ride' });
    await expect(reviewItem.locator('.suggestion-meta')).toContainText('location changed');

    // --- Step 2: click row → land on review-update page ---
    await reviewItem.locator('a').click();
    await page.waitForURL(new RegExp(`/admin/events/${encodeURIComponent(EVENT_ID).replace(/%2F/i, '%2F')}/review-update`), { timeout: 10_000 });
    await page.waitForLoadState('networkidle');
    await waitForHydration(page, 20_000);

    // --- Step 3: review page shows "Whole-series fields" with location diff ---
    await expect(page.locator('h2', { hasText: 'Whole-series fields' })).toBeVisible();

    // The diff row should show the location field
    const locationRow = page.locator('.review-update__row', { hasText: 'location' });
    await expect(locationRow).toBeVisible();
    await expect(locationRow).toContainText('Location A');
    await expect(locationRow).toContainText('Location B');

    // --- Step 4: click "Apply selected" → redirect back to /admin/events ---
    await page.locator('button', { hasText: 'Apply selected' }).click();
    await page.waitForURL('/admin/events', { timeout: 15_000 });

    // --- Step 5: review row should be gone (snapshot advanced to V2) ---
    await page.waitForLoadState('networkidle');
    await waitForHydration(page);

    // Wait up to 10 s for the suggestions panel to settle — after applying, the
    // snapshot matches the feed so the review row must not appear.
    // (An import suggestion for *other* organizers may still show; we check absence
    //  of this specific item.)
    await expect(
      page.locator('.suggestion-item', { hasText: 'E2E Review Test Ride' })
    ).toHaveCount(0, { timeout: 10_000 });
  });

  test('Scenario 2: review page accessible directly and shows organizer name', async ({ page }) => {
    // Seed snapshot (V1 = Location A) and feed with change (Location B).
    seedSnapshot('Location A');
    seedFeedCache('Location B');

    await loginAs(page, token);
    // Navigate directly to the review-update page (no sidebar click required).
    await page.goto(`/admin/events/${encodeURIComponent(EVENT_ID)}/review-update`);
    await page.waitForLoadState('networkidle');
    await waitForHydration(page, 20_000);

    // Organizer name should appear in the subheader.
    await expect(page.locator('.review-update__sub')).toContainText('E2E Calendar Club');

    // Back link is present.
    await expect(page.locator('.review-update__back')).toBeVisible();

    // Both action buttons are rendered.
    await expect(page.locator('button', { hasText: 'Apply selected' })).toBeVisible();
    await expect(page.locator('button', { hasText: 'Dismiss' })).toBeVisible();
  });

  test('Scenario 3: dismissing review row removes it from sidebar', async ({ page }) => {
    seedSnapshot('Location A');
    seedFeedCache('Location B');

    await loginAs(page, token);
    await page.goto('/admin/events');
    await waitForHydration(page);

    await expect(
      page.locator('.suggestion-item', { hasText: 'E2E Review Test Ride' })
    ).toBeVisible({ timeout: 15_000 });

    // Click dismiss (×) on the review row.
    const reviewItem = page.locator('.suggestion-item', { hasText: 'E2E Review Test Ride' });
    await reviewItem.locator('.suggestion-dismiss').click();

    // Row disappears immediately (optimistic UI).
    await expect(
      page.locator('.suggestion-item', { hasText: 'E2E Review Test Ride' })
    ).toHaveCount(0, { timeout: 5_000 });

    // Reload — still dismissed.
    await page.reload();
    await waitForHydration(page);
    await expect(
      page.locator('.suggestion-item', { hasText: 'E2E Review Test Ride' })
    ).toHaveCount(0, { timeout: 10_000 });
  });
});

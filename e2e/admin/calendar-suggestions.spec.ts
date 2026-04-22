import { test, expect } from '@playwright/test';
import Database from 'better-sqlite3';
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
  const db = openDb();
  try {
    // Use dates within the 180-day suggestions horizon (relative to today).
    // The series end is kept far enough out that it doesn't expire during a run.
    const eventsJson = JSON.stringify({
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
    });
    db.prepare(`
      INSERT OR REPLACE INTO calendar_feed_cache
      (organizer_slug, source_url, events_json, updated_at)
      VALUES (?, ?, ?, ?)
    `).run(ORG_SLUG, ICS_URL, eventsJson, new Date().toISOString());
  } finally {
    db.close();
  }
}

function clearFeedCache() {
  const db = openDb();
  try {
    db.prepare('DELETE FROM calendar_feed_cache WHERE organizer_slug = ?').run(ORG_SLUG);
    db.prepare('DELETE FROM calendar_suggestion_dismissals WHERE organizer_slug = ?').run(ORG_SLUG);
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

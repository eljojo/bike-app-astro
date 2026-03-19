import { test, expect } from '@playwright/test';
import { seedContentEdit, clearContentEdits } from './helpers.ts';

const PENDING_SLUG = '2099/preview-test';

/** Minimal EventDetail JSON that passes Zod validation. */
const pendingEventData = JSON.stringify({
  id: PENDING_SLUG,
  slug: 'preview-test',
  year: '2099',
  name: 'Sunset River Ride',
  start_date: '2099-08-15',
  start_time: '18:00',
  location: 'Riverside Park',
  distances: '45 km',
  tags: ['gravel'],
  body: 'A beautiful evening ride along the river.',
  routes: [],
  waypoints: [],
  results: [],
  media: [],
});

test.describe('Event Preview', () => {
  test.beforeEach(() => {
    clearContentEdits('events', PENDING_SLUG);
  });

  test.afterAll(() => {
    clearContentEdits('events', PENDING_SLUG);
  });

  test('renders pending event from D1 cache at preview route', async ({ page }) => {
    seedContentEdit('events', PENDING_SLUG, pendingEventData);

    await page.goto(`/_event-preview/${PENDING_SLUG}`);

    // Preview banner should be visible
    await expect(page.locator('.event-preview-banner')).toBeVisible();
    await expect(page.locator('.event-preview-banner')).toContainText('Preview');

    // Event data renders correctly
    await expect(page.locator('h1')).toContainText('Sunset River Ride');
    await expect(page.locator('.event-detail-facts')).toContainText('Riverside Park');
    await expect(page.locator('.event-detail-facts')).toContainText('45 km');
    await expect(page.locator('.event-description')).toContainText('beautiful evening ride');

    // No-cache header
    const response = await page.goto(`/_event-preview/${PENDING_SLUG}`);
    expect(response?.headers()['cache-control']).toBe('no-store');
  });

  test('returns 404 for non-existent event at preview route', async ({ page }) => {
    const response = await page.goto('/_event-preview/2099/does-not-exist');
    expect(response?.status()).toBe(404);
  });

  test('built event does not show preview banner', async ({ page }) => {
    // bike-fest is a fixture event that exists in the static build
    await page.goto('/events/2099/bike-fest');

    await expect(page.locator('h1')).toContainText('Bike Fest');
    await expect(page.locator('.event-preview-banner')).not.toBeVisible();
  });
});

/**
 * E2E tests for the Local Bike Shops (LBS) feature.
 *
 * Fixtures:
 * - lbs-test-shop.md: bike shop organizer with social_links (phone, email, booking)
 * - lbs-featured-shop.md: featured bike shop (appears in both communities + LBS sections)
 * - lbs-shop-location-a.md, lbs-shop-location-b.md: place fixtures linked to lbs-test-shop
 */
import { test, expect } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import matter from 'gray-matter';
import { FIXTURE_DIR } from './fixture-setup.ts';
import {
  seedSession, cleanupSession, loginAs,
  clearContentEdits, cleanupCreatedFiles,
  waitForHydration,
} from './helpers.ts';

// ---------------------------------------------------------------------------
// 1. Communities index — LBS section exists
// ---------------------------------------------------------------------------

test.describe('Bike Shops Page', () => {
  let token: string;

  test.beforeAll(() => {
    token = seedSession();
  });

  test.afterAll(() => {
    cleanupSession(token);
  });

  test('shows bike shops on dedicated /bike-shops page', async ({ page }) => {
    await loginAs(page, token);
    await page.goto('/bike-shops');
    await page.waitForLoadState('networkidle');

    // The heading should be visible
    await expect(page.locator('h1', { hasText: 'Local Bike Shops' })).toBeVisible();

    // Both bike shops should appear
    await expect(page.getByText('LBS Test Shop')).toBeVisible();
    await expect(page.getByText('LBS Featured Shop')).toBeVisible();
  });

  test('communities page does not show bike shops', async ({ page }) => {
    await loginAs(page, token);
    await page.goto('/communities');
    await page.waitForLoadState('networkidle');

    // Bike shops should NOT appear on the communities page
    await expect(page.getByText('LBS Test Shop')).not.toBeVisible();
    // Featured bike shops also should not appear on communities anymore
    await expect(page.getByText('LBS Featured Shop')).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 2. Community detail — locations section with map
// ---------------------------------------------------------------------------

test.describe('Community Detail — Locations', () => {
  let token: string;

  test.beforeAll(() => {
    token = seedSession();
  });

  test.afterAll(() => {
    cleanupSession(token);
  });

  test('bike shop detail page shows locations section', async ({ page }) => {
    await loginAs(page, token);
    await page.goto('/communities/lbs-test-shop');
    await page.waitForLoadState('networkidle');

    // Should show the locations heading
    await expect(page.locator('h2', { hasText: 'Locations' })).toBeVisible();

    // Should show both location cards with lettered markers
    await expect(page.getByText('LBS Shop Location A')).toBeVisible();
    await expect(page.getByText('LBS Shop Location B')).toBeVisible();

    // Should show the address
    await expect(page.getByText('123 Test St, Ottawa, ON')).toBeVisible();

    // Should have the PinMap container
    await expect(page.locator('.pin-map')).toBeVisible();

    // Should have lettered markers (A, B)
    await expect(page.locator('.community-location-letter', { hasText: 'A' })).toBeVisible();
    await expect(page.locator('.community-location-letter', { hasText: 'B' })).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 3. Community detail — contact card
// ---------------------------------------------------------------------------

test.describe('Community Detail — Contact Card', () => {
  let token: string;

  test.beforeAll(() => {
    token = seedSession();
  });

  test.afterAll(() => {
    cleanupSession(token);
  });

  test('bike shop shows contact card with phone, email, and booking', async ({ page }) => {
    await loginAs(page, token);
    await page.goto('/communities/lbs-test-shop');
    await page.waitForLoadState('networkidle');

    const contactCard = page.locator('.community-contact-card');
    await expect(contactCard).toBeVisible();

    // Phone link with tel: href
    const phoneLink = contactCard.locator('a[href^="tel:"]');
    await expect(phoneLink).toBeVisible();

    // Email link with mailto: href
    const emailLink = contactCard.locator('a[href^="mailto:"]');
    await expect(emailLink).toBeVisible();

    // Booking button
    const bookingLink = contactCard.locator('.community-contact-booking');
    await expect(bookingLink).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 4. Place save — organizer + social_links round-trip
// ---------------------------------------------------------------------------

test.describe('Place Save — Organizer Round-Trip', () => {
  let token: string;

  test.beforeAll(() => {
    token = seedSession();
  });

  test.beforeEach(() => {
    clearContentEdits('places', 'lbs-save-test');
    cleanupCreatedFiles(['demo/places/lbs-save-test.md']);
  });

  test.afterAll(() => {
    cleanupSession(token);
    cleanupCreatedFiles(['demo/places/lbs-save-test.md']);
  });

  test('place save preserves organizer and social_links fields', async ({ page }) => {
    await loginAs(page, token);
    await page.goto('/admin/places');
    await page.waitForLoadState('networkidle');

    // Create a place via API with organizer and social_links
    const res = await page.evaluate(async () => {
      const response = await fetch('/api/places/new', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          frontmatter: {
            name: 'LBS Save Test',
            category: 'bike-shop',
            lat: 45.42,
            lng: -75.69,
            organizer: 'lbs-test-shop',
            social_links: [{ platform: 'booking', url: 'https://example.com/book' }],
          },
        }),
      });
      return { status: response.status, body: await response.json() };
    });

    expect(res.status).toBe(200);

    // Verify the file was written with organizer and social_links
    const placePath = path.join(FIXTURE_DIR, 'demo/places/lbs-save-test.md');
    expect(fs.existsSync(placePath)).toBe(true);

    const { data: fm } = matter(fs.readFileSync(placePath, 'utf-8'));
    expect(fm.organizer).toBe('lbs-test-shop');
    expect(fm.social_links).toEqual([{ platform: 'booking', url: 'https://example.com/book' }]);
  });
});

// ---------------------------------------------------------------------------
// 5. Place editor — organizer picker shows only bike shops
// ---------------------------------------------------------------------------

test.describe('Place Editor — Organizer Picker', () => {
  let token: string;

  test.beforeAll(() => {
    token = seedSession();
  });

  test.afterAll(() => {
    cleanupSession(token);
  });

  test('organizer dropdown shows only bike-shop tagged organizers', async ({ page }) => {
    await loginAs(page, token);
    await page.goto('/admin/places/lbs-shop-location-a');
    await page.waitForLoadState('networkidle');

    // Wait for the editor to render before checking hydration
    const select = page.locator('#place-organizer');
    await expect(select).toBeVisible({ timeout: 15000 });
    await waitForHydration(page);

    // Should have the bike shop as an option
    await expect(select.locator('option', { hasText: 'LBS Test Shop' })).toBeAttached();
    await expect(select.locator('option', { hasText: 'LBS Featured Shop' })).toBeAttached();

    // Should NOT have non-bike-shop organizers
    await expect(select.locator('option', { hasText: 'Demo Cycling Club' })).not.toBeAttached();
    await expect(select.locator('option', { hasText: 'Community Admin Test Org' })).not.toBeAttached();
  });
});

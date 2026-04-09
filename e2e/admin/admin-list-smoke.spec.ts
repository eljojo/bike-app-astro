/**
 * Smoke tests for admin list pages — anonymous (no auth needed).
 *
 * Each test catches "the loader broke and the page is empty."
 * Bike paths list is covered by bike-path-admin.spec.ts — not duplicated here.
 */
import { test, expect } from '@playwright/test';

test.describe('Admin list — anonymous', () => {
  test('routes list loads with content', async ({ page }) => {
    await page.goto('/admin/routes');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveURL(/\/admin\/routes/);
    await expect(page.locator('h1')).toContainText('Routes');

    // Fixture route from fixture-setup.ts
    await expect(page.getByText('Towards Carp')).toBeVisible({ timeout: 10000 });
  });

  test('events list loads with content', async ({ page }) => {
    await page.goto('/admin/events');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveURL(/\/admin\/events/);
    await expect(page.locator('h1')).toContainText('Events');

    // Fixture event from fixture-setup.ts (read-only, safe for all workers)
    await expect(page.getByText('Bike Fest')).toBeVisible({ timeout: 10000 });
  });

  test('places list loads with at least one item', async ({ page }) => {
    await page.goto('/admin/places');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveURL(/\/admin\/places/);
    await expect(page.locator('h1')).toContainText('Places');

    // Fixture places from fixture-setup.ts
    await expect(page.locator('.place-list-item').first()).toBeVisible({ timeout: 10000 });
  });

  test('communities list loads with at least one item', async ({ page }) => {
    await page.goto('/admin/communities');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveURL(/\/admin\/communities/);
    await expect(page.locator('h1')).toContainText('Communities');

    // Fixture organizer from fixture-setup.ts — use exact match to avoid
    // matching both the community card and the admin list link
    await expect(page.getByRole('link', { name: 'Demo Cycling Club', exact: true })).toBeVisible({ timeout: 10000 });
  });
});

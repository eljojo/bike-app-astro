import { test, expect } from '@playwright/test';
import { seedSession, cleanupSession, loginAs, waitForHydration } from './helpers.ts';

test.describe('Settings — Passkey Empty State', () => {
  let token: string;

  test.beforeAll(() => {
    token = seedSession({ role: 'editor', username: 'passkey-test-user', email: 'passkey-test@test.local' });
  });

  test.afterAll(() => {
    cleanupSession(token);
  });

  test('user without passkeys sees empty state explanation', async ({ page }) => {
    await loginAs(page, token);
    await page.goto('/admin/settings');
    await page.waitForLoadState('networkidle');
    await waitForHydration(page);

    // The passkey section should exist
    await expect(page.getByText('Passkeys', { exact: true })).toBeVisible();

    // The empty state should show the explanation text
    const emptyState = page.locator('.passkey-empty-state');
    await expect(emptyState).toBeVisible();
    await expect(emptyState).toContainText('Passkeys let you sign in without email');

    // The "Add a passkey" button should be visible (not "+ Add passkey" which is shown when passkeys exist)
    await expect(page.getByRole('button', { name: 'Add a passkey' })).toBeVisible();
  });

  test('no passkey list is shown in empty state', async ({ page }) => {
    await loginAs(page, token);
    await page.goto('/admin/settings');
    await page.waitForLoadState('networkidle');
    await waitForHydration(page);

    // The passkey list should not exist when there are no passkeys
    await expect(page.locator('.passkey-list')).not.toBeVisible();
  });
});

test.describe('Settings — Blue Dot Nudge', () => {
  let token: string;

  test.beforeAll(() => {
    // Editor without passkeys — should see the blue dot
    token = seedSession({ role: 'editor', username: 'nudge-dot-user', email: 'nudge-dot@test.local' });
  });

  test.afterAll(() => {
    cleanupSession(token);
  });

  test('blue dot appears next to Settings in dropdown for user without passkeys', async ({ page }) => {
    await loginAs(page, token);
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');

    // The settings-nudge-dot should be present in the dropdown
    const nudgeDot = page.locator('.settings-nudge-dot');
    await expect(nudgeDot).toHaveCount(1);

    // Open the dropdown to verify it's visible
    await page.evaluate(() => {
      document.getElementById('user-menu-dropdown')?.classList.add('open');
    });
    await expect(nudgeDot).toBeVisible();
  });

  test('guest user does NOT see blue dot (dot only for non-guest without passkeys)', async ({ page }) => {
    const guestToken = seedSession({ role: 'guest', username: 'guest-no-dot', email: null });
    try {
      await loginAs(page, guestToken);
      // Use events page which has AdminHeader
      await page.goto('/admin/events');
      await page.waitForLoadState('networkidle');

      // Guest should not have the nudge dot
      const nudgeDot = page.locator('.settings-nudge-dot');
      await expect(nudgeDot).toHaveCount(0);
    } finally {
      cleanupSession(guestToken);
    }
  });
});

import { test, expect } from '@playwright/test';
import { seedSession, cleanupSession, loginAs, waitForHydration } from './helpers.ts';

test.describe('Settings page', () => {
  let token: string;

  test.beforeAll(() => {
    token = seedSession({ role: 'admin', username: 'Settings Tester', email: 'settings@test.local' });
  });

  test.afterAll(() => {
    cleanupSession(token);
  });

  test.beforeEach(async ({ page }) => {
    await loginAs(page, token);
    await page.goto('/admin/settings');
    await page.waitForLoadState('networkidle');
    await waitForHydration(page);
  });

  test('settings page loads with current username', async ({ page }) => {
    const heading = page.locator('.admin-header h1');
    await expect(heading).toHaveText('Settings');

    const usernameInput = page.locator('#settings-username');
    await expect(usernameInput).toBeVisible();
    const value = await usernameInput.inputValue();
    expect(value).toBe('Settings Tester');
  });

  test('gravatar image is visible', async ({ page }) => {
    const avatar = page.locator('img.settings-avatar');
    await expect(avatar).toBeVisible();
  });

  test('can change username and save', async ({ page }) => {
    const usernameInput = page.locator('#settings-username');
    await usernameInput.fill('New Username');
    await page.locator('button.btn-primary', { hasText: 'Save' }).click();
    await expect(page.locator('.save-success')).toBeVisible({ timeout: 5000 });
  });

  test('analytics opt-out checkbox works', async ({ page }) => {
    const analyticsCheckbox = page.locator('input[type="checkbox"]').last();
    await analyticsCheckbox.check();
    await page.locator('button.btn-primary', { hasText: 'Save' }).click();
    await expect(page.locator('.save-success')).toBeVisible({ timeout: 5000 });

    const plausibleIgnore = await page.evaluate(() => localStorage.getItem('plausible_ignore'));
    expect(plausibleIgnore).toBe('true');
  });

  test('username dropdown shows Settings link', async ({ page }) => {
    // Navigate to admin index page
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');

    // The dropdown contains a Settings link even when hidden
    const settingsLink = page.locator('#user-menu-dropdown a[href="/admin/settings"]');
    await expect(settingsLink).toHaveCount(1);
    await expect(settingsLink).toHaveText('Settings');

    // Toggle the dropdown open via JS (bypasses CSP issues with inline scripts in preview mode)
    await page.evaluate(() => {
      document.getElementById('user-menu-dropdown')?.classList.add('open');
    });
    await expect(settingsLink).toBeVisible();
  });
});

test.describe('Guest user dropdown', () => {
  let guestToken: string;

  test.beforeAll(() => {
    guestToken = seedSession({ role: 'guest', username: 'test-guest', email: null });
  });

  test.afterAll(() => {
    cleanupSession(guestToken);
  });

  test('guest user sees Create account link', async ({ page }) => {
    await loginAs(page, guestToken);
    // Use events page which has AdminHeader (route detail pages use a different layout)
    await page.goto('/admin/events');
    await page.waitForLoadState('networkidle');

    // The dropdown contains a "Create account" link even when hidden
    const createAccountLink = page.locator('#user-menu-dropdown a:has-text("Create account")');
    await expect(createAccountLink).toHaveCount(1);

    // Toggle dropdown open via JS (bypasses CSP issues with inline scripts in preview mode)
    await page.evaluate(() => {
      document.getElementById('user-menu-dropdown')?.classList.add('open');
    });
    await expect(createAccountLink).toBeVisible();
  });
});

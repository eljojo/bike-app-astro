import { test, expect } from '@playwright/test';
import { seedSession, cleanupSession, loginAs } from './helpers.ts';

test.describe('Community Editing — Auth Gate', () => {
  test('unauthenticated user sees auth gate on admin pages', async ({ page }) => {
    await page.goto('/admin/routes/carp');
    await page.waitForLoadState('networkidle');

    // Should redirect to gate page
    expect(page.url()).toContain('/gate');
    await expect(page.locator('.gate-options')).toBeVisible();
    await expect(page.getByText('Continue as guest')).toBeVisible();
    await expect(page.getByText('Sign in')).toBeVisible();
  });

  test('guest account creation redirects to editor', async ({ page }) => {
    await page.goto('/gate?returnTo=/admin/routes/carp');
    await page.waitForLoadState('networkidle');

    // Click continue as guest
    const guestButton = page.getByText('Continue as guest');
    await guestButton.click();

    // Should redirect to the editor
    await page.waitForURL(url => url.pathname === '/admin/routes/carp', { timeout: 10000 });
    await expect(page.locator('h1')).toContainText('Edit:');
  });
});

test.describe('Community Editing — Guest Direct Commit', () => {
  let token: string;

  test.beforeAll(() => {
    token = seedSession({ role: 'guest', username: 'cyclist-e2e1', email: null });
  });

  test.afterAll(() => {
    cleanupSession(token);
  });

  test('guest saves directly to main branch', async ({ page }) => {
    await loginAs(page, token);

    await page.goto('/admin/routes/carp');
    await page.waitForLoadState('networkidle');

    // Verify we landed on the editor (not redirected to gate)
    await expect(page.locator('h1')).toContainText('Edit:');
    await page.waitForTimeout(2000);

    // Make an edit
    const taglineInput = page.locator('#route-tagline');
    await taglineInput.fill('E2E test tagline');

    // Save
    const saveButton = page.getByRole('button', { name: /save/i });
    await saveButton.click();

    // Wait for save response — saves directly, shows success
    await expect(page.locator('.save-success')).toBeVisible({ timeout: 15000 });
  });
});

test.describe('Community Editing — Admin Direct Commit', () => {
  let token: string;

  test.beforeAll(() => {
    token = seedSession({ role: 'admin', username: 'Admin User', email: 'admin@test.local' });
  });

  test.afterAll(() => {
    cleanupSession(token);
  });

  test('admin saves directly', async ({ page }) => {
    await loginAs(page, token);

    await page.goto('/admin/routes/carp');
    await page.waitForLoadState('networkidle');

    // Verify we landed on the editor
    await expect(page.locator('h1')).toContainText('Edit:');
  });
});

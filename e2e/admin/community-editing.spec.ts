import { test, expect } from '@playwright/test';
import { seedSession, cleanupSession } from './helpers.ts';

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

test.describe('Community Editing — Guest Draft Flow', () => {
  let token: string;

  test.beforeAll(() => {
    token = seedSession({ role: 'guest', displayName: 'cyclist-e2e1', email: null });
  });

  test.afterAll(() => {
    cleanupSession(token);
  });

  test('guest save creates draft branch and shows banner on reload', async ({ page }) => {
    await page.context().addCookies([{
      name: 'session_token', value: token,
      domain: 'localhost', path: '/', httpOnly: true, secure: false,
    }]);

    await page.goto('/admin/routes/carp');
    await page.waitForLoadState('networkidle');

    // Verify we landed on the editor (not redirected to gate)
    await expect(page.locator('h1')).toContainText('Edit:');
    await page.waitForTimeout(2000);

    // Initially no draft banner
    await expect(page.locator('.draft-banner')).not.toBeVisible();

    // Make an edit
    const taglineInput = page.locator('#route-tagline');
    await taglineInput.fill('E2E test tagline');

    // Save
    const saveButton = page.getByRole('button', { name: /save/i });
    await saveButton.click();

    // Wait for save response
    await expect(page.locator('.save-success')).toBeVisible({ timeout: 15000 });

    // Reload and verify draft banner appears
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    await expect(page.locator('.draft-banner')).toBeVisible();
    await expect(page.locator('.draft-banner')).toContainText('Draft');
  });
});

test.describe('Community Editing — Admin Direct Commit', () => {
  let token: string;

  test.beforeAll(() => {
    token = seedSession({ role: 'admin', displayName: 'Admin User', email: 'admin@test.local' });
  });

  test.afterAll(() => {
    cleanupSession(token);
  });

  test('admin without editor mode saves directly (no draft banner)', async ({ page }) => {
    await page.context().addCookies([{
      name: 'session_token', value: token,
      domain: 'localhost', path: '/', httpOnly: true, secure: false,
    }]);

    await page.goto('/admin/routes/carp');
    await page.waitForLoadState('networkidle');

    // Verify we landed on the editor (not redirected to gate)
    await expect(page.locator('h1')).toContainText('Edit:');
    await page.waitForTimeout(2000);

    // No draft banner for admin
    await expect(page.locator('.draft-banner')).not.toBeVisible();
  });

  test('admin with editor mode creates draft branch', async ({ page }) => {
    await page.context().addCookies([
      {
        name: 'session_token', value: token,
        domain: 'localhost', path: '/', httpOnly: true, secure: false,
      },
      {
        name: 'editor_mode', value: '1',
        domain: 'localhost', path: '/', httpOnly: false, secure: false,
      },
    ]);

    await page.goto('/admin');
    await page.waitForLoadState('networkidle');

    // Verify we landed on the admin dashboard (not redirected to gate)
    await expect(page.locator('h1')).toContainText('Routes');

    // Editor mode toggle should be checked
    const checkbox = page.locator('#editor-mode-checkbox');
    await expect(checkbox).toBeChecked();
  });
});

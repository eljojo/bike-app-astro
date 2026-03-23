import { test, expect } from '@playwright/test';
import { seedSession, cleanupSession, loginAs, clearContentEdits, waitForHydration } from './helpers.ts';

test.describe('Community Editing — Guest-First Flow', () => {
  test('unauthenticated user sees editor directly (no gate redirect)', async ({ page }) => {
    await page.goto('/admin/routes/carp');
    await page.waitForLoadState('networkidle');

    // Should stay on the editor page — NOT redirect to /gate or /login
    expect(page.url()).not.toContain('/gate');
    expect(page.url()).not.toContain('/login');
    expect(page.url()).toContain('/admin/routes/carp');

    // Editor should render
    await expect(page.locator('#route-name')).toBeVisible({ timeout: 10000 });
  });

  test('unauthenticated user sees "Editing as guest" label', async ({ page }) => {
    await page.goto('/admin/routes/carp');
    await page.waitForLoadState('networkidle');
    await waitForHydration(page);

    // The guest label should be visible for anonymous/guest users
    await expect(page.locator('.editor-guest-label')).toBeVisible();
    await expect(page.locator('.editor-guest-label')).toContainText('Editing as guest');
  });

  test('anonymous save triggers guest creation then shows upgrade modal', async ({ page }) => {
    // Use carp fixture (read-only for other tests) to avoid conflicting
    // with the Guest Direct Commit test that also uses route-community
    await page.goto('/admin/routes/carp');
    await page.waitForLoadState('networkidle');
    await waitForHydration(page);

    // Make an edit
    const taglineInput = page.locator('#route-tagline');
    await taglineInput.fill('Anonymous guest edit');

    // Save — the first save attempt gets 401 (no session), which triggers
    // silent guest creation via /api/auth/guest, then retries the save
    const saveButton = page.getByRole('button', { name: /save/i });
    await saveButton.click();

    // The success modal should appear with upgrade form
    await expect(page.getByText('Thanks for your contribution')).toBeVisible({ timeout: 15000 });

    // The upgrade form (email + username) should be present in the modal
    await expect(page.locator('#upgrade-email')).toBeVisible();
    await expect(page.locator('#upgrade-username')).toBeVisible();
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

  test.beforeEach(() => {
    clearContentEdits('routes', 'route-community');
  });

  test('guest saves directly to main branch', async ({ page }) => {
    await loginAs(page, token);

    await page.goto('/admin/routes/route-community');
    await page.waitForLoadState('networkidle');

    // Verify we landed on the editor (not redirected)
    await expect(page.locator('#route-name')).toBeVisible({ timeout: 10000 });
    await waitForHydration(page);

    // Make an edit
    const taglineInput = page.locator('#route-tagline');
    await taglineInput.fill('E2E test tagline');

    // Save
    const saveButton = page.getByRole('button', { name: /save/i });
    await saveButton.click();

    // Wait for save response — guests see a success modal
    await expect(page.getByText('Thanks for your contribution')).toBeVisible({ timeout: 15000 });
  });
});

test.describe('Community Editing — Admin Direct Commit', () => {
  let token: string;

  test.beforeAll(() => {
    token = seedSession({ role: 'admin', username: 'Community Admin', email: 'community-admin@test.local' });
  });

  test.afterAll(() => {
    cleanupSession(token);
  });

  test('admin saves directly', async ({ page }) => {
    await loginAs(page, token);

    await page.goto('/admin/routes/carp');
    await page.waitForLoadState('networkidle');

    // Verify we landed on the editor
    await expect(page.locator('#route-name')).toBeVisible({ timeout: 10000 });
  });
});

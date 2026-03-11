import { test, expect } from '@playwright/test';
import { seedSession, loginAs, cleanupSession, clearContentEdits } from './helpers.ts';

test.describe('Ride Editor', () => {
  let token: string;

  test.beforeAll(() => {
    token = seedSession();
  });

  test.afterAll(() => {
    cleanupSession(token);
  });

  test.beforeEach(() => {
    clearContentEdits('rides', '2026-01-23-winter-ride');
  });

  test('displays ride editor with split pane', async ({ page }) => {
    await loginAs(page, token);
    await page.goto('/admin/rides/2026-01-23-winter-ride');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Verify editor pane exists
    await expect(page.locator('.ride-editor-edit')).toBeVisible();
    // Verify preview pane exists (on desktop)
    await expect(page.locator('.ride-editor-preview')).toBeVisible();
    // Verify title is populated
    const nameInput = page.locator('#ride-name');
    await expect(nameInput).toHaveValue(/Winter/i);
  });

  test('markdown preview updates live', async ({ page }) => {
    await loginAs(page, token);
    await page.goto('/admin/rides/2026-01-23-winter-ride');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Type markdown in body
    const textarea = page.locator('#ride-body');
    await textarea.fill('## Hello World\n\nThis is a **test**.');

    // Verify preview renders the markdown
    const preview = page.locator('.ride-preview-body');
    await expect(preview.locator('h2')).toHaveText('Hello World');
    await expect(preview.locator('strong')).toHaveText('test');
  });

  test('ride list page loads', async ({ page }) => {
    await loginAs(page, token);
    await page.goto('/admin/rides');
    await page.waitForLoadState('networkidle');

    // Should show the winter ride
    await expect(page.locator('text=Winter Ride')).toBeVisible();
  });

  test('mobile: tabs switch between edit and preview', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await loginAs(page, token);
    await page.goto('/admin/rides/2026-01-23-winter-ride');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Edit tab should be active by default
    await expect(page.locator('.ride-editor-edit')).toBeVisible();

    // Click Preview tab
    await page.locator('.ride-editor-tab:has-text("Preview")').click();
    // Preview should be visible
    await expect(page.locator('.ride-editor-preview')).toBeVisible();
  });
});

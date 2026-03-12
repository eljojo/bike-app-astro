import { test, expect } from '@playwright/test';
import { seedSession, loginAs, cleanupSession, clearContentEdits } from './helpers.ts';

test.describe('Public rides page filtering', () => {
  test('year filter hides rides from other years', async ({ page }) => {
    await page.goto('/rides');
    await page.waitForLoadState('networkidle');

    // All rides visible initially
    await expect(page.locator('.ride-card')).toHaveCount(3);

    // Click 2026 year filter
    await page.locator('[data-year="2026"]').click();

    // Only the winter ride (2026) should be visible
    await expect(page.locator('.ride-card:visible')).toHaveCount(1);
    await expect(page.locator('.ride-card:visible')).toContainText('Winter Ride');
  });

  test('tour filter shows only tour rides', async ({ page }) => {
    await page.goto('/rides');
    await page.waitForLoadState('networkidle');

    await page.locator('[data-filter="tours"]').click();

    await expect(page.locator('.ride-card:visible')).toHaveCount(1);
    await expect(page.locator('.ride-card:visible')).toContainText('Tour Day One');
  });

  test('long filter shows rides 50km or more', async ({ page }) => {
    await page.goto('/rides');
    await page.waitForLoadState('networkidle');

    await page.locator('[data-filter="long"]').click();

    await expect(page.locator('.ride-card:visible')).toHaveCount(1);
    await expect(page.locator('.ride-card:visible')).toContainText('Long Summer Ride');
  });

  test('filter count updates after filtering', async ({ page }) => {
    await page.goto('/rides');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('#rides-count')).toHaveText('3 rides');

    await page.locator('[data-year="2026"]').click();
    await expect(page.locator('#rides-count')).toHaveText('1 of 3 rides');
  });
});

test.describe('Admin rides page', () => {
  let token: string;

  test.beforeAll(() => {
    token = seedSession();
  });

  test.afterAll(() => {
    cleanupSession(token);
  });

  test('/admin redirects to /admin/rides for blog instance', async ({ page }) => {
    await loginAs(page, token);
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');

    expect(page.url()).toContain('/admin/rides');
  });

  test('admin/rides shows "Rides" in header title', async ({ page }) => {
    await loginAs(page, token);
    await page.goto('/admin/rides');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('.admin-header h1')).toHaveText('Rides');
  });

  test('admin/rides shows "Rides" in nav, not "Routes"', async ({ page }) => {
    await loginAs(page, token);
    await page.goto('/admin/rides');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('.admin-nav-link.active')).toHaveText('Rides');
    await expect(page.locator('.admin-nav')).not.toContainText('Routes');
  });

  test('admin/rides year filter hides rides from other years', async ({ page }) => {
    await loginAs(page, token);
    await page.goto('/admin/rides');
    await page.waitForLoadState('networkidle');

    // All rides visible initially
    await expect(page.locator('.route-list-item')).toHaveCount(3);

    // Select 2026 in year dropdown
    await page.locator('#year-filter').selectOption('2026');

    await expect(page.locator('.route-list-item:visible')).toHaveCount(1);
    await expect(page.locator('.route-list-item:visible')).toContainText('Winter Ride');
  });

  test('admin/rides tour filter shows only tour rides', async ({ page }) => {
    await loginAs(page, token);
    await page.goto('/admin/rides');
    await page.waitForLoadState('networkidle');

    await page.locator('[data-filter="tours"]').click();

    await expect(page.locator('.route-list-item:visible')).toHaveCount(1);
    await expect(page.locator('.route-list-item:visible')).toContainText('Tour Day One');
  });
});

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

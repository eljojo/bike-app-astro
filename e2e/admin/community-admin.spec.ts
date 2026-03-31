/**
 * E2E tests for admin community (organizer) CRUD and role-based access.
 *
 * Fixture: community-admin-test.md (rich organizer with tagline, tags, featured)
 * Created files are cleaned up between runs.
 */
import { test, expect } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import matter from 'gray-matter';
import { FIXTURE_DIR } from './fixture-setup.ts';
import {
  seedSession, cleanupSession, loginAs,
  clearContentEdits, cleanupCreatedFiles, restoreFixtureFiles,
  waitForHydration,
} from './helpers.ts';

// ---------------------------------------------------------------------------
// 1. Admin communities list
// ---------------------------------------------------------------------------

test.describe('Community Admin — List', () => {
  let token: string;

  test.beforeAll(() => {
    token = seedSession();
  });

  test.afterAll(() => {
    cleanupSession(token);
  });

  test('load admin communities list and verify organizers appear', async ({ page }) => {
    await loginAs(page, token);
    await page.goto('/admin/communities');
    await page.waitForLoadState('networkidle');

    // The list should contain our test organizers (4 fixture files)
    await expect(page.locator('.community-list-item')).toHaveCount(6, { timeout: 10000 });
    const list = page.locator('.admin-list-main');
    await expect(list.getByText('Demo Cycling Club')).toBeVisible();
    await expect(list.getByText('Community Admin Test Org')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 2. Community detail — fields populated
// ---------------------------------------------------------------------------

test.describe('Community Admin — Detail', () => {
  let token: string;

  test.beforeAll(() => {
    token = seedSession();
  });

  test.afterAll(() => {
    cleanupSession(token);
  });

  test('navigate to community detail and verify fields are populated', async ({ page }) => {
    await loginAs(page, token);
    await page.goto('/admin/communities/community-admin-test');
    await page.waitForLoadState('networkidle');

    // Wait for the Preact island to hydrate
    await expect(page.locator('#community-name')).toBeVisible({ timeout: 10000 });

    // Verify fields
    await expect(page.locator('#community-name')).toHaveValue('Community Admin Test Org');
    await expect(page.locator('#community-tagline')).toHaveValue('A tagline for testing');

    // Tags render as pills in the tag editor
    const tagPills = page.locator('.tag-editor .tag-pill');
    await expect(tagPills).toHaveCount(2);
    await expect(tagPills.nth(0)).toContainText('gravel');
    await expect(tagPills.nth(1)).toContainText('touring');
  });
});

// ---------------------------------------------------------------------------
// 3. Edit community fields (name, tagline), save, verify file updated
// ---------------------------------------------------------------------------

test.describe('Community Admin — Edit', () => {
  let token: string;

  test.beforeAll(() => {
    token = seedSession();
  });

  test.beforeEach(() => {
    clearContentEdits('organizers', 'community-admin-test');
    restoreFixtureFiles(['demo/organizers/community-admin-test.md']);
  });

  test.afterAll(() => {
    cleanupSession(token);
    restoreFixtureFiles(['demo/organizers/community-admin-test.md']);
  });

  test('edit community name and tagline via UI and verify file updated', async ({ page }) => {
    await loginAs(page, token);
    await page.goto('/admin/communities/community-admin-test');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('#community-name')).toBeVisible({ timeout: 10000 });
    await waitForHydration(page);

    const headBefore = execSync('git rev-parse HEAD', { cwd: FIXTURE_DIR }).toString().trim();

    // Edit fields via UI
    await page.locator('#community-name').fill('Updated Community Name');
    await page.locator('#community-tagline').fill('Updated tagline');

    // Click save
    const saveButton = page.getByRole('button', { name: /save/i });
    await saveButton.click();

    // Wait for success message
    await expect(page.getByText('Saved! Your edit will be live in a few minutes.')).toBeVisible({ timeout: 15000 });

    // Verify git commit happened
    const headAfter = execSync('git rev-parse HEAD', { cwd: FIXTURE_DIR }).toString().trim();
    expect(headAfter).not.toBe(headBefore);

    // Verify file was updated
    const filePath = path.join(FIXTURE_DIR, 'demo/organizers/community-admin-test.md');
    const fileMd = fs.readFileSync(filePath, 'utf-8');
    const { data: fm } = matter(fileMd);
    expect(fm.name).toBe('Updated Community Name');
    expect(fm.tagline).toBe('Updated tagline');
  });
});

// ---------------------------------------------------------------------------
// 4. Create new community, verify file created and redirect
// ---------------------------------------------------------------------------

test.describe('Community Admin — Create', () => {
  let token: string;

  test.beforeAll(() => {
    token = seedSession();
  });

  test.beforeEach(() => {
    clearContentEdits('organizers', 'new-test-community');
    cleanupCreatedFiles(['demo/organizers/new-test-community.md']);
  });

  test.afterAll(() => {
    cleanupSession(token);
    cleanupCreatedFiles(['demo/organizers/new-test-community.md']);
  });

  test('create new community via UI and verify file created', async ({ page }) => {
    await loginAs(page, token);
    await page.goto('/admin/communities/new');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('#community-name')).toBeVisible({ timeout: 10000 });
    await waitForHydration(page);

    const headBefore = execSync('git rev-parse HEAD', { cwd: FIXTURE_DIR }).toString().trim();

    // Fill in the form
    await page.locator('#community-name').fill('New Test Community');
    await page.locator('#community-tagline').fill('A brand new community');

    // Click save
    const saveButton = page.getByRole('button', { name: /save/i });
    await saveButton.click();

    // After create, the editor redirects to the new community's edit page
    await page.waitForURL(url => url.pathname === '/admin/communities/new-test-community', { timeout: 15000 });

    // Verify git commit happened
    const headAfter = execSync('git rev-parse HEAD', { cwd: FIXTURE_DIR }).toString().trim();
    expect(headAfter).not.toBe(headBefore);

    // Verify file was created
    const filePath = path.join(FIXTURE_DIR, 'demo/organizers/new-test-community.md');
    expect(fs.existsSync(filePath)).toBe(true);

    const fileMd = fs.readFileSync(filePath, 'utf-8');
    const { data: fm } = matter(fileMd);
    expect(fm.name).toBe('New Test Community');
    expect(fm.tagline).toBe('A brand new community');
  });
});

// ---------------------------------------------------------------------------
// 5. Featured checkbox only visible to admin role
// ---------------------------------------------------------------------------

test.describe('Community Admin — Featured Visibility (admin)', () => {
  let token: string;

  test.beforeAll(() => {
    token = seedSession();
  });

  test.afterAll(() => {
    cleanupSession(token);
  });

  test('featured checkbox is visible for admin role', async ({ page }) => {
    await loginAs(page, token);
    await page.goto('/admin/communities/community-admin-test');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('#community-name')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Featured community')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 6. Guest users can edit content but not toggle featured
// ---------------------------------------------------------------------------

test.describe('Community Admin — Guest Role', () => {
  let guestToken: string;

  test.beforeAll(() => {
    guestToken = seedSession({ role: 'guest', username: 'community-guest', email: null });
  });

  test.beforeEach(() => {
    clearContentEdits('organizers', 'community-admin-test');
    restoreFixtureFiles(['demo/organizers/community-admin-test.md']);
  });

  test.afterAll(() => {
    cleanupSession(guestToken);
    restoreFixtureFiles(['demo/organizers/community-admin-test.md']);
  });

  test('guest can see editor fields but not the featured checkbox', async ({ page }) => {
    await loginAs(page, guestToken);
    await page.goto('/admin/communities/community-admin-test');
    await page.waitForLoadState('networkidle');

    // Editor fields are visible
    await expect(page.locator('#community-name')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#community-tagline')).toBeVisible();

    // Featured checkbox should NOT be visible for guests
    await expect(page.getByText('Featured community')).not.toBeVisible();
  });

  test('guest can save community edits via UI', async ({ page }) => {
    await loginAs(page, guestToken);
    await page.goto('/admin/communities/community-admin-test');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('#community-name')).toBeVisible({ timeout: 10000 });
    await waitForHydration(page);

    // Edit fields via UI
    await page.locator('#community-name').fill('Guest Edited Community');
    await page.locator('#community-tagline').fill('Edited by guest');

    // Click save — guests see a success modal
    const saveButton = page.getByRole('button', { name: /save/i });
    await saveButton.click();

    await expect(page.getByText('Your anonymous contribution has been saved')).toBeVisible({ timeout: 15000 });
  });
});

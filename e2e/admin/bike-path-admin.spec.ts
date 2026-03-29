/**
 * E2E tests for admin bike path list and editor.
 *
 * Fixture: bikepaths.yml (canal-pathway) + bike-paths/canal-pathway.md
 */
import { test, expect } from '@playwright/test';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { FIXTURE_DIR } from './fixture-setup.ts';
import {
  seedSession, cleanupSession, loginAs,
  clearContentEdits, restoreFixtureFiles,
  waitForHydration,
} from './helpers.ts';

// ---------------------------------------------------------------------------
// 1. Admin bike paths list — browsable without auth
// ---------------------------------------------------------------------------

test.describe('Bike Path Admin — List (anonymous)', () => {
  test('loads admin bike paths list without login', async ({ page }) => {
    await page.goto('/admin/paths');
    await page.waitForLoadState('networkidle');

    // Page should load (not redirect to login) thanks to browsable admin paths
    await expect(page).toHaveURL(/\/admin\/paths/);
    // Should see at least one bike path
    await expect(page.locator('h1')).toContainText('Bike Paths');
  });
});

// ---------------------------------------------------------------------------
// 2. Admin bike paths list — authenticated
// ---------------------------------------------------------------------------

test.describe('Bike Path Admin — List', () => {
  let token: string;

  test.beforeAll(() => {
    token = seedSession();
  });

  test.afterAll(() => {
    cleanupSession(token);
  });

  test('loads bike paths list with content', async ({ page }) => {
    await loginAs(page, token);
    await page.goto('/admin/paths');
    await page.waitForLoadState('networkidle');

    // Canal Pathway should appear in the list
    await expect(page.getByText('Canal Pathway')).toBeVisible({ timeout: 10000 });
  });
});

// ---------------------------------------------------------------------------
// 3. Bike path detail — fields populated
// ---------------------------------------------------------------------------

test.describe('Bike Path Admin — Detail', () => {
  let token: string;

  test.beforeAll(() => {
    token = seedSession();
  });

  test.afterAll(() => {
    cleanupSession(token);
  });

  test('loads bike path editor and verifies fields', async ({ page }) => {
    await loginAs(page, token);
    await page.goto('/admin/paths/canal-pathway');
    await page.waitForLoadState('networkidle');

    // Wait for Preact island to hydrate
    await waitForHydration(page);

    // Verify name field is populated
    await expect(page.locator('#bike-path-name')).toHaveValue('Canal Pathway');

    // Verify tags are visible
    const tagPills = page.locator('.tag-editor .tag-pill');
    await expect(tagPills).toHaveCount(1);
    await expect(tagPills.nth(0)).toContainText('scenic');
  });
});

// ---------------------------------------------------------------------------
// 4. Edit bike path — save and verify file
// ---------------------------------------------------------------------------

test.describe('Bike Path Admin — Edit', () => {
  let token: string;

  test.beforeAll(() => {
    token = seedSession();
  });

  test.beforeEach(() => {
    clearContentEdits('bike-paths', 'canal-pathway');
    restoreFixtureFiles(['demo/bike-paths/canal-pathway.md']);
  });

  test.afterAll(() => {
    cleanupSession(token);
    restoreFixtureFiles(['demo/bike-paths/canal-pathway.md']);
  });

  test('edit bike path name and save', async ({ page }) => {
    await loginAs(page, token);
    await page.goto('/admin/paths/canal-pathway');
    await page.waitForLoadState('networkidle');
    await waitForHydration(page);

    const headBefore = execSync('git rev-parse HEAD', { cwd: FIXTURE_DIR }).toString().trim();

    // Edit name
    await page.locator('#bike-path-name').fill('Updated Canal Pathway');

    // Save
    const saveButton = page.getByRole('button', { name: /save/i });
    await saveButton.click();

    // Wait for success
    await expect(page.getByText('Saved')).toBeVisible({ timeout: 15000 });

    // Verify git commit
    const headAfter = execSync('git rev-parse HEAD', { cwd: FIXTURE_DIR }).toString().trim();
    expect(headAfter).not.toBe(headBefore);

    // Verify file
    const filePath = path.join(FIXTURE_DIR, 'demo/bike-paths/canal-pathway.md');
    const fileMd = fs.readFileSync(filePath, 'utf-8');
    const { data: fm } = matter(fileMd);
    expect(fm.name).toBe('Updated Canal Pathway');
    // Verify includes are preserved (frontmatter merge)
    expect(fm.includes).toEqual(['canal-pathway']);
  });
});

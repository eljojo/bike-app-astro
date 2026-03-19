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

    // The list should contain our test organizers (3 fixture files)
    await expect(page.locator('.community-list-item')).toHaveCount(3, { timeout: 10000 });
    await expect(page.getByText('Demo Cycling Club')).toBeVisible();
    await expect(page.getByText('Community Admin Test Org')).toBeVisible();
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
    await expect(page.locator('#community-tags')).toHaveValue('gravel, touring');
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

  test('edit community name and tagline via API and verify file updated', async ({ page }) => {
    await loginAs(page, token);
    await page.goto('/admin/communities/community-admin-test');
    await page.waitForLoadState('networkidle');

    const headBefore = execSync('git rev-parse HEAD', { cwd: FIXTURE_DIR }).toString().trim();

    const res = await page.evaluate(async () => {
      const response = await fetch('/api/organizers/community-admin-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          frontmatter: {
            name: 'Updated Community Name',
            tagline: 'Updated tagline',
            tags: ['gravel', 'touring'],
            featured: true,
          },
          body: 'A bio for testing community admin editing.',
        }),
      });
      return { status: response.status, body: await response.json() };
    });

    expect(res.status).toBe(200);

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

  test('create new community via API and verify file created', async ({ page }) => {
    await loginAs(page, token);
    await page.goto('/admin/communities/new');
    await page.waitForLoadState('networkidle');

    const headBefore = execSync('git rev-parse HEAD', { cwd: FIXTURE_DIR }).toString().trim();

    const res = await page.evaluate(async () => {
      const response = await fetch('/api/organizers/new', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          frontmatter: {
            name: 'New Test Community',
            tagline: 'A brand new community',
          },
        }),
      });
      return { status: response.status, body: await response.json() };
    });

    expect(res.status).toBe(200);
    expect(res.body.id).toBe('new-test-community');

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

  test('guest can save community edits', async ({ page }) => {
    await loginAs(page, guestToken);
    await page.goto('/admin/communities/community-admin-test');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('#community-name')).toBeVisible({ timeout: 10000 });

    const res = await page.evaluate(async () => {
      const response = await fetch('/api/organizers/community-admin-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          frontmatter: {
            name: 'Guest Edited Community',
            tagline: 'Edited by guest',
          },
          body: 'A bio for testing community admin editing.',
        }),
      });
      return { status: response.status, body: await response.json() };
    });

    expect(res.status).toBe(200);
  });
});

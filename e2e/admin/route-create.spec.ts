import { test, expect } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import matter from 'gray-matter';
import { FIXTURE_DIR } from './fixture-setup.ts';
import { seedSession, cleanupSession, loginAs } from './helpers.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test.describe('Route Creation', () => {
  let token: string;

  test.beforeAll(async () => {
    token = seedSession();
  });

  test.afterAll(() => {
    cleanupSession(token);
  });

  test('upload GPX, name route, save, verify commit', async ({ page }) => {
    await loginAs(page, token);

    await page.goto('/admin/routes/new');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Upload a GPX file
    const gpxInput = page.locator('input[type="file"][accept=".gpx"]');
    const gpxPath = path.join(FIXTURE_DIR, 'ottawa/routes/carp/main.gpx');
    await gpxInput.setInputFiles(gpxPath);

    // Wait for name/slug fields to appear
    const nameInput = page.locator('#new-route-name');
    await expect(nameInput).toBeVisible({ timeout: 5000 });

    // The name should be auto-extracted from the filename
    await expect(nameInput).not.toHaveValue('');

    // Override with a test name
    await nameInput.fill('Test Trail');
    const slugInput = page.locator('#new-route-slug');
    await expect(slugInput).toHaveValue('test-trail');

    // Click Create Route to enter editor phase
    await page.locator('button.btn-primary', { hasText: 'Create Route' }).click();

    // Wait for route editor to load
    await page.waitForTimeout(2000);

    // Verify we're now in the editor phase (has Save button)
    const saveButton = page.locator('button.btn-primary', { hasText: 'Save' });
    await expect(saveButton).toBeVisible({ timeout: 5000 });

    // Record git HEAD before save
    const headBefore = execSync('git rev-parse HEAD', { cwd: FIXTURE_DIR }).toString().trim();

    // Save the new route
    await saveButton.click();

    // Should redirect to the edit page for the new route
    await page.waitForURL('**/admin/routes/test-trail', { timeout: 10000 });

    // Verify git commit happened
    const headAfter = execSync('git rev-parse HEAD', { cwd: FIXTURE_DIR }).toString().trim();
    expect(headAfter).not.toBe(headBefore);

    // Verify files were created
    const routeDir = path.join(FIXTURE_DIR, 'ottawa/routes/test-trail');
    expect(fs.existsSync(routeDir)).toBe(true);

    const indexMd = fs.readFileSync(path.join(routeDir, 'index.md'), 'utf-8');
    const { data: fm } = matter(indexMd);
    expect(fm.name).toBe('Test Trail');
    expect(fm.status).toBe('draft');
    expect(fm.variants).toHaveLength(1);

    // GPX file should exist
    expect(fs.existsSync(path.join(routeDir, 'main.gpx'))).toBe(true);
  });
});

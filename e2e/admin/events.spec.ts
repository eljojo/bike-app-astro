import { test, expect } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import matter from 'gray-matter';
import { FIXTURE_DIR } from './fixture-setup.ts';
import { seedSession, cleanupSession, loginAs, clearContentEdits, cleanupCreatedFiles, restoreFixtureFiles } from './helpers.ts';

test.describe('Event Editing', () => {
  let token: string;

  test.beforeAll(async () => {
    token = seedSession();
  });

  test.afterAll(() => {
    cleanupSession(token);
  });

  test.beforeEach(() => {
    clearContentEdits('events', '2099/event-edit');
    // Restore modified fixture files so retries see original state
    restoreFixtureFiles(['demo/events/2099/event-edit.md']);
  });

  test('edit existing event and save', async ({ page }) => {
    await loginAs(page, token);

    await page.goto('/admin/events/2099/event-edit');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Verify the form loaded with fixture data
    const nameInput = page.locator('#event-name');
    await expect(nameInput).toHaveValue('Editable Event');

    const startDateInput = page.locator('#event-start-date');
    await expect(startDateInput).toHaveValue('2099-07-20');

    // Edit the event name
    const testName = `Editable Event ${Date.now()}`;
    await nameInput.fill(testName);

    // Record git HEAD before save
    const headBefore = execSync('git rev-parse HEAD', { cwd: FIXTURE_DIR }).toString().trim();

    // Save
    const saveButton = page.locator('button.btn-primary', { hasText: 'Save' });
    await saveButton.click();

    // Verify success
    await expect(page.locator('.save-success')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.save-success')).toContainText('Saved');

    // Verify git commit happened
    const headAfter = execSync('git rev-parse HEAD', { cwd: FIXTURE_DIR }).toString().trim();
    expect(headAfter).not.toBe(headBefore);

    // Verify file on disk
    const eventMd = fs.readFileSync(
      path.join(FIXTURE_DIR, 'demo/events/2099/event-edit.md'),
      'utf-8'
    );
    const { data: fm, content: body } = matter(eventMd);
    expect(fm.name).toBe(testName);
    expect(fm.start_date).toBe('2099-07-20');
    expect(fm.start_time).toBe('09:00');
    expect(fm.location).toBe('City Park');
    expect(body.trim()).toBe('An event for testing edits.');

    // Reload and verify persistence
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    await expect(nameInput).toHaveValue(testName);
  });
});

test.describe('Event Creation', () => {
  let token: string;

  test.beforeAll(async () => {
    token = seedSession();
  });

  test.afterAll(() => {
    cleanupSession(token);
  });

  test.beforeEach(() => {
    clearContentEdits('events', '2099/test-ride-2099');
    cleanupCreatedFiles(['demo/events/2099/test-ride-2099.md']);
  });

  test('create new event and save', async ({ page }) => {
    await loginAs(page, token);

    await page.goto('/admin/events/new');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Fill required fields
    const nameInput = page.locator('#event-name');
    await nameInput.fill('Test Ride 2099');

    const startDateInput = page.locator('#event-start-date');
    await startDateInput.fill('2099-09-20');

    // Add optional description
    const bodyTextarea = page.locator('#event-body');
    await bodyTextarea.fill('A lovely fall ride through the Gatineau Hills.');

    // Record git HEAD before save
    const headBefore = execSync('git rev-parse HEAD', { cwd: FIXTURE_DIR }).toString().trim();

    // Save
    const saveButton = page.locator('button.btn-primary', { hasText: 'Save' });
    await saveButton.click();

    // Should redirect to the new event's edit page
    await page.waitForURL('**/admin/events/2099/test-ride-2099', { timeout: 10000 });

    // Verify git commit happened
    const headAfter = execSync('git rev-parse HEAD', { cwd: FIXTURE_DIR }).toString().trim();
    expect(headAfter).not.toBe(headBefore);

    // Verify file was created
    const eventPath = path.join(FIXTURE_DIR, 'demo/events/2099/test-ride-2099.md');
    expect(fs.existsSync(eventPath)).toBe(true);

    const eventMd = fs.readFileSync(eventPath, 'utf-8');
    const { data: fm, content: body } = matter(eventMd);
    expect(fm.name).toBe('Test Ride 2099');
    expect(fm.start_date).toBe('2099-09-20');
    expect(body.trim()).toBe('A lovely fall ride through the Gatineau Hills.');
  });
});

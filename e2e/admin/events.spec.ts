import { test, expect } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import matter from 'gray-matter';
import { FIXTURE_DIR } from './fixture-setup.ts';
import { seedSession, cleanupSession, loginAs, clearContentEdits, cleanupCreatedFiles, restoreFixtureFiles, waitForHydration } from './helpers.ts';

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
    await waitForHydration(page);

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
    await waitForHydration(page);
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

    await page.goto('/admin/events/new?full=1');
    await page.waitForLoadState('networkidle');
    await waitForHydration(page);

    // Skip the poster upload phase (EventCreator → EventEditor)
    await page.locator('button.btn-link', { hasText: 'Skip' }).click();

    // Screenshot the empty event creation form
    await expect(page.locator('#event-name')).toBeVisible();
    await page.screenshot({ path: 'e2e/test-results/event-creation-form.png', fullPage: true });

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

test.describe('Event Duplication', () => {
  let token: string;

  test.beforeAll(async () => {
    token = seedSession();
  });

  test.afterAll(() => {
    cleanupSession(token);
  });

  test.beforeEach(() => {
    // Source ("Bike Fest" → bike-fest) is read-only; reset its commit state and
    // anything our save side-effects may have left behind across retries.
    clearContentEdits('events', '2099/bike-fest');
    clearContentEdits('events', '2099/bike-fest-2');
    cleanupCreatedFiles([
      'demo/events/2099/bike-fest-2.md',
      // Leftover from earlier broken-test runs that picked the wrong source
      'demo/events/2099/editable-event.md',
    ]);
  });

  test('duplicate button opens full editor with prefilled name and auto-suffixes the slug on save', async ({ page }) => {
    await loginAs(page, token);

    await page.goto('/admin/events');
    await page.waitForLoadState('networkidle');

    // Click the duplicate (copy) button for bike-fest specifically (matched by
    // the row's primary link href, since multiple events may share the "Bike
    // Fest" display name across retries). "Bike Fest" → slugify → "bike-fest"
    // === source filename, so saving the copy with the same name forces the
    // slug-collision path on the server.
    const row = page.locator('.event-list-item', {
      has: page.locator('a.event-list-link[href="/admin/events/2099/bike-fest"]'),
    });
    await row.locator('.event-copy-btn').click();

    // Bug 1: must include full=1 and land in the EventEditor (not the wizard upload phase)
    await page.waitForURL(/\/admin\/events\/new\?.*\bfull=1\b/);
    expect(page.url()).toMatch(/copy=2099(%2F|\/)bike-fest\b/);
    await waitForHydration(page);

    // Wizard's drop zone must NOT be present; full editor's name field MUST be prefilled
    await expect(page.locator('.drop-zone--hero')).toHaveCount(0);
    const nameInput = page.locator('#event-name');
    await expect(nameInput).toHaveValue('Bike Fest');

    // Dates are blanked when duplicating so the user picks new ones
    const startDateInput = page.locator('#event-start-date');
    await expect(startDateInput).toHaveValue('');

    // Pick a date in the same year — name unchanged, so slug would collide with the source
    await startDateInput.fill('2099-08-15');

    await page.locator('button.btn-primary', { hasText: 'Save' }).click();

    // Bug 2: server auto-suffixes the colliding slug instead of returning 409.
    // (We don't assert HEAD advanced — the fixture repo persists across test
    // invocations, so a prior run's identical commit can make a save a no-op
    // at the git layer while still writing the expected file on disk.)
    await page.waitForURL('**/admin/events/2099/bike-fest-2', { timeout: 10000 });

    const newPath = path.join(FIXTURE_DIR, 'demo/events/2099/bike-fest-2.md');
    expect(fs.existsSync(newPath)).toBe(true);
    const { data: fm } = matter(fs.readFileSync(newPath, 'utf-8'));
    expect(fm.name).toBe('Bike Fest');
    expect(fm.start_date).toBe('2099-08-15');

    // Original must remain untouched
    const sourcePath = path.join(FIXTURE_DIR, 'demo/events/2099/bike-fest.md');
    const { data: sourceFm } = matter(fs.readFileSync(sourcePath, 'utf-8'));
    expect(sourceFm.start_date).toBe('2099-06-15');
  });
});

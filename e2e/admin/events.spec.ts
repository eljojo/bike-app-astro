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
    // Sources are read-only; reset cache + duplicate-target slots so retries
    // and prior runs don't bleed into the next attempt.
    clearContentEdits('events', '2099/bike-fest');
    clearContentEdits('events', '2099/bike-fest-2');
    clearContentEdits('events', '2099/dup-source');
    clearContentEdits('events', '2099/dup-source-2');
    cleanupCreatedFiles([
      'demo/events/2099/bike-fest-2.md',
      'demo/events/2099/dup-source-2.md',
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
    // Codex finding: server-side copyData sets previous_event = source id, but
    // EventCreator was dropping it on the way to EventEditor. The new event must
    // record its lineage back to the source.
    expect(fm.previous_event).toBe('2099/bike-fest');

    // Original must remain untouched
    const sourcePath = path.join(FIXTURE_DIR, 'demo/events/2099/bike-fest.md');
    const { data: sourceFm } = matter(fs.readFileSync(sourcePath, 'utf-8'));
    expect(sourceFm.start_date).toBe('2099-06-15');
  });

  test('duplicate forwards meet_time, review_url, tags, distances, edition, and URLs into the new event', async ({ page }) => {
    await loginAs(page, token);

    await page.goto('/admin/events');
    await page.waitForLoadState('networkidle');

    const row = page.locator('.event-list-item', {
      has: page.locator('a.event-list-link[href="/admin/events/2099/dup-source"]'),
    });
    await row.locator('.event-copy-btn').click();

    await page.waitForURL(/\/admin\/events\/new\?.*\bfull=1\b/);
    await waitForHydration(page);

    await expect(page.locator('#event-name')).toHaveValue('Dup Source');
    await page.locator('#event-start-date').fill('2099-11-15');

    await page.locator('button.btn-primary', { hasText: 'Save' }).click();
    await page.waitForURL('**/admin/events/2099/dup-source-2', { timeout: 10000 });

    const newPath = path.join(FIXTURE_DIR, 'demo/events/2099/dup-source-2.md');
    const { data: fm } = matter(fs.readFileSync(newPath, 'utf-8'));

    // Fields that copyData previously dropped — these all came from the source
    expect(fm.meet_time).toBe('09:30');
    expect(fm.review_url).toBe('https://example.com/review');
    expect(fm.tags).toEqual(['test-tag-alpha', 'test-tag-beta']);
    expect(fm.distances).toBe('50km, 100km');
    expect(fm.edition).toBe('5th');
    expect(fm.event_url).toBe('https://example.com/event');
    expect(fm.map_url).toBe('https://example.com/map');
    expect(fm.start_time).toBe('10:00');
    expect(fm.location).toBe('Hilltop Plaza');
    expect(fm.registration_url).toBe('https://example.com/register');

    // Lineage points to the source we duplicated from, not the source's own
    // previous_event chain (the new event starts a new branch from this source).
    expect(fm.previous_event).toBe('2099/dup-source');

    // Date came from user input, not from source
    expect(fm.start_date).toBe('2099-11-15');
  });
});

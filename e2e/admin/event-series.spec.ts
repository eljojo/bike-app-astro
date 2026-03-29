import { test, expect } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import matter from 'gray-matter';
import { FIXTURE_DIR } from './fixture-setup.ts';
import { seedSession, cleanupSession, loginAs, clearContentEdits, restoreFixtureFiles } from './helpers.ts';

test.describe('Series Editor — Recurring', () => {
  let token: string;

  test.beforeAll(async () => {
    token = seedSession();
  });

  test.afterAll(() => {
    cleanupSession(token);
  });

  test.beforeEach(() => {
    clearContentEdits('events', '2099/event-series-recurring');
    restoreFixtureFiles(['demo/events/2099/event-series-recurring.md']);
  });

  test('loads recurring series and shows calendar preview', async ({ page }) => {
    await loginAs(page, token);
    await page.goto('/admin/events/2099/event-series-recurring');
    await page.waitForLoadState('networkidle');

    // Wait for Preact island hydration
    await expect(page.locator('.series-editor[data-hydrated]')).toBeAttached({ timeout: 15000 });

    // Verify basic fields loaded
    await expect(page.locator('#event-name')).toHaveValue('Weekly Ride Series');

    // Series toggle should show "Series" as active
    const seriesBtn = page.locator('.series-toggle-btn--active');
    await expect(seriesBtn).toHaveText('Series');

    // Recurring tab should be active
    const recurringTab = page.locator('.series-mode-tab--active');
    await expect(recurringTab).toHaveText('Recurring');

    // Verify recurring fields populated
    await expect(page.locator('#series-frequency')).toHaveValue('weekly');
    await expect(page.locator('#series-day')).toHaveValue('tuesday');
    await expect(page.locator('#series-season-start')).toHaveValue('2099-03-04');
    await expect(page.locator('#series-season-end')).toHaveValue('2099-05-27');

    // Calendar should show occurrence count
    const occCount = page.locator('.series-occurrence-count');
    await expect(occCount).toBeVisible();
    await expect(occCount).toContainText('occurrence');

    // Screenshot the recurring series editor
    await page.screenshot({ path: 'e2e/test-results/series-editor-recurring.png', fullPage: true });
  });

  test('edit recurring series and save', async ({ page }) => {
    await loginAs(page, token);
    await page.goto('/admin/events/2099/event-series-recurring');
    await page.waitForLoadState('networkidle');

    // Wait for Preact island hydration
    await expect(page.locator('.series-editor[data-hydrated]')).toBeAttached({ timeout: 15000 });

    // Change frequency to biweekly
    await page.locator('#series-frequency').selectOption('biweekly');

    // Change day to wednesday
    await page.locator('#series-day').selectOption('wednesday');

    // Record git HEAD before save
    const headBefore = execSync('git rev-parse HEAD', { cwd: FIXTURE_DIR }).toString().trim();

    // Save
    const saveButton = page.locator('button.btn-primary', { hasText: 'Save' });
    await saveButton.click();

    // Verify success
    await expect(page.locator('.save-success')).toBeVisible({ timeout: 10000 });

    // Verify git commit happened
    const headAfter = execSync('git rev-parse HEAD', { cwd: FIXTURE_DIR }).toString().trim();
    expect(headAfter).not.toBe(headBefore);

    // Verify file on disk
    const eventMd = fs.readFileSync(
      path.join(FIXTURE_DIR, 'demo/events/2099/event-series-recurring.md'),
      'utf-8'
    );
    const { data: fm } = matter(eventMd);
    expect(fm.series.recurrence).toBe('biweekly');
    expect(fm.series.recurrence_day).toBe('wednesday');
    expect(fm.series.season_start).toBe('2099-03-04');
    expect(fm.series.season_end).toBe('2099-05-27');

    // Reload and verify persistence
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.series-editor[data-hydrated]')).toBeAttached({ timeout: 15000 });
    await expect(page.locator('#series-frequency')).toHaveValue('biweekly');
    await expect(page.locator('#series-day')).toHaveValue('wednesday');
  });

  test('add override with note on a recurring date', async ({ page }) => {
    await loginAs(page, token);
    await page.goto('/admin/events/2099/event-series-recurring');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.series-editor[data-hydrated]')).toBeAttached({ timeout: 15000 });

    // Click the first occurrence date (2099-03-04, a Tuesday) on the calendar
    const occurrenceBtn = page.locator('button.series-day--active').first();
    await occurrenceBtn.click();

    // Popover should appear
    const popover = page.locator('.series-popover');
    await expect(popover).toBeVisible({ timeout: 5000 });

    // Fill in note and location
    await popover.locator('input[placeholder="Override location"]').fill('Riverside Park');
    await popover.locator('input[placeholder*="Special"]').fill('Bring lights');

    // Save override
    await popover.locator('button', { hasText: 'Save override' }).click();

    // Popover should close
    await expect(popover).not.toBeVisible();

    // Override should appear in the override list
    const overrideItem = page.locator('.series-override-item');
    await expect(overrideItem).toHaveCount(1);
    await expect(overrideItem.first()).toContainText('Bring lights');
    await expect(overrideItem.first()).toContainText('Riverside Park');

    // Record git HEAD before save
    const headBefore = execSync('git rev-parse HEAD', { cwd: FIXTURE_DIR }).toString().trim();

    // Save the event
    const saveButton = page.locator('button.btn-primary', { hasText: 'Save' });
    await saveButton.click();
    await expect(page.locator('.save-success')).toBeVisible({ timeout: 10000 });

    // Verify git commit happened
    const headAfter = execSync('git rev-parse HEAD', { cwd: FIXTURE_DIR }).toString().trim();
    expect(headAfter).not.toBe(headBefore);

    // Verify file on disk
    const eventMd = fs.readFileSync(
      path.join(FIXTURE_DIR, 'demo/events/2099/event-series-recurring.md'),
      'utf-8'
    );
    const { data: fm } = matter(eventMd);
    expect(fm.series.overrides).toHaveLength(1);
    expect(fm.series.overrides[0].note).toBe('Bring lights');
    expect(fm.series.overrides[0].location).toBe('Riverside Park');
  });
});

test.describe('Series Editor — Specific Dates', () => {
  let token: string;

  test.beforeAll(async () => {
    token = seedSession();
  });

  test.afterAll(() => {
    cleanupSession(token);
  });

  test.beforeEach(() => {
    clearContentEdits('events', '2099/event-series-schedule');
    restoreFixtureFiles(['demo/events/2099/event-series-schedule.md']);
  });

  test('loads specific dates series and shows schedule', async ({ page }) => {
    await loginAs(page, token);
    await page.goto('/admin/events/2099/event-series-schedule');
    await page.waitForLoadState('networkidle');

    // Wait for Preact island hydration
    await expect(page.locator('.series-editor[data-hydrated]')).toBeAttached({ timeout: 15000 });

    // Verify basic fields loaded
    await expect(page.locator('#event-name')).toHaveValue('Monthly Social');

    // Series toggle should show "Series" as active
    const seriesBtn = page.locator('.series-toggle-btn--active');
    await expect(seriesBtn).toHaveText('Series');

    // Specific dates tab should be active
    const scheduleTab = page.locator('.series-mode-tab--active');
    await expect(scheduleTab).toHaveText('Specific dates');

    // Should show the three schedule entries
    const scheduleItems = page.locator('.series-schedule-item');
    await expect(scheduleItems).toHaveCount(3);

    // Verify dates are displayed
    await expect(scheduleItems.nth(0)).toContainText('2099-04-10');
    await expect(scheduleItems.nth(1)).toContainText('2099-05-08');
    await expect(scheduleItems.nth(2)).toContainText('2099-06-12');

    // Calendar should show 3 occurrences
    const occCount = page.locator('.series-occurrence-count');
    await expect(occCount).toContainText('3 occurrences');

    // Screenshot the specific dates series editor
    await page.screenshot({ path: 'e2e/test-results/series-editor-schedule.png', fullPage: true });
  });

  test('add a date and save', async ({ page }) => {
    await loginAs(page, token);
    await page.goto('/admin/events/2099/event-series-schedule');
    await page.waitForLoadState('networkidle');

    // Wait for Preact island hydration
    await expect(page.locator('.series-editor[data-hydrated]')).toBeAttached({ timeout: 15000 });

    // Add a new date
    await page.locator('#series-new-date').fill('2099-07-10');
    await page.locator('#series-new-location').fill('Riverside Park');
    await page.locator('button.btn-small', { hasText: 'Add' }).click();

    // Should now show 4 schedule items
    await expect(page.locator('.series-schedule-item')).toHaveCount(4);
    await expect(page.locator('.series-occurrence-count')).toContainText('4 occurrences');

    // Record git HEAD before save
    const headBefore = execSync('git rev-parse HEAD', { cwd: FIXTURE_DIR }).toString().trim();

    // Save
    const saveButton = page.locator('button.btn-primary', { hasText: 'Save' });
    await saveButton.click();

    // Verify success
    await expect(page.locator('.save-success')).toBeVisible({ timeout: 10000 });

    // Verify git commit happened
    const headAfter = execSync('git rev-parse HEAD', { cwd: FIXTURE_DIR }).toString().trim();
    expect(headAfter).not.toBe(headBefore);

    // Verify file on disk
    const eventMd = fs.readFileSync(
      path.join(FIXTURE_DIR, 'demo/events/2099/event-series-schedule.md'),
      'utf-8'
    );
    const { data: fm } = matter(eventMd);
    expect(fm.series.schedule).toHaveLength(4);
    const dates = fm.series.schedule.map((s: { date: string }) => s.date);
    expect(dates).toContain('2099-07-10');

    // Verify the new entry has a location override
    const newEntry = fm.series.schedule.find((s: { date: string }) => s.date === '2099-07-10');
    expect(newEntry.location).toBe('Riverside Park');

    // Reload and verify persistence
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.series-editor[data-hydrated]')).toBeAttached({ timeout: 15000 });
    await expect(page.locator('.series-schedule-item')).toHaveCount(4);
  });

  test('remove a date and save', async ({ page }) => {
    await loginAs(page, token);
    await page.goto('/admin/events/2099/event-series-schedule');
    await page.waitForLoadState('networkidle');

    // Wait for Preact island hydration
    await expect(page.locator('.series-editor[data-hydrated]')).toBeAttached({ timeout: 15000 });

    // Remove the first date — calendar grid can overlap at wide layouts, force the click
    const firstRemoveBtn = page.locator('.series-schedule-item').first().locator('.btn-link', { hasText: 'remove' });
    await firstRemoveBtn.click({ force: true });

    // Should now show 2 schedule items
    await expect(page.locator('.series-schedule-item')).toHaveCount(2);

    // Record git HEAD before save
    const headBefore = execSync('git rev-parse HEAD', { cwd: FIXTURE_DIR }).toString().trim();

    // Save
    const saveButton = page.locator('button.btn-primary', { hasText: 'Save' });
    await saveButton.click();

    await expect(page.locator('.save-success')).toBeVisible({ timeout: 10000 });

    const headAfter = execSync('git rev-parse HEAD', { cwd: FIXTURE_DIR }).toString().trim();
    expect(headAfter).not.toBe(headBefore);

    // Verify file — should have 2 dates, first one removed
    const eventMd = fs.readFileSync(
      path.join(FIXTURE_DIR, 'demo/events/2099/event-series-schedule.md'),
      'utf-8'
    );
    const { data: fm } = matter(eventMd);
    expect(fm.series.schedule).toHaveLength(2);
    const dates = fm.series.schedule.map((s: { date: string }) => s.date);
    expect(dates).not.toContain('2099-04-10');
    expect(dates).toContain('2099-05-08');
    expect(dates).toContain('2099-06-12');
  });

  test('add note to an existing schedule date via popover', async ({ page }) => {
    await loginAs(page, token);
    await page.goto('/admin/events/2099/event-series-schedule');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.series-editor[data-hydrated]')).toBeAttached({ timeout: 15000 });

    // Click the first occurrence date (2099-04-10) on the calendar
    const occurrenceBtn = page.locator('button.series-day--active').first();
    await occurrenceBtn.click();

    // Popover should appear
    const popover = page.locator('.series-popover');
    await expect(popover).toBeVisible({ timeout: 5000 });

    // Fill in note
    await popover.locator('input[placeholder*="Special"]').fill('Pizza night');

    // Save override
    await popover.locator('button', { hasText: 'Save override' }).click();

    // Popover should close
    await expect(popover).not.toBeVisible();

    // The note badge should appear on the schedule item
    const firstItem = page.locator('.series-schedule-item').first();
    await expect(firstItem).toContainText('Pizza night');

    // Record git HEAD before save
    const headBefore = execSync('git rev-parse HEAD', { cwd: FIXTURE_DIR }).toString().trim();

    // Save the event
    const saveButton = page.locator('button.btn-primary', { hasText: 'Save' });
    await saveButton.click();
    await expect(page.locator('.save-success')).toBeVisible({ timeout: 10000 });

    // Verify git commit happened
    const headAfter = execSync('git rev-parse HEAD', { cwd: FIXTURE_DIR }).toString().trim();
    expect(headAfter).not.toBe(headBefore);

    // Verify file on disk
    const eventMd = fs.readFileSync(
      path.join(FIXTURE_DIR, 'demo/events/2099/event-series-schedule.md'),
      'utf-8'
    );
    const { data: fm } = matter(eventMd);
    const entry = fm.series.schedule.find((s: { date: string }) => s.date === '2099-04-10');
    expect(entry.note).toBe('Pizza night');
  });
});

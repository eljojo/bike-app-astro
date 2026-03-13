import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import matter from 'gray-matter';
import { FIXTURE_DIR } from './fixture-setup.ts';
import { seedSession, cleanupSession, loginAs, clearContentEdits, restoreFixtureFiles } from './helpers.ts';

const EVENT_SLUG = '2024/brm-300-vuelta-rocas';
const EVENT_FILE = 'demo-club/events/2024/brm-300-vuelta-rocas.md';

test.describe('Club Waypoint Editing', () => {
  let token: string;

  test.beforeAll(() => {
    token = seedSession();
  });

  test.afterAll(() => {
    cleanupSession(token);
  });

  test.beforeEach(() => {
    clearContentEdits('events', EVENT_SLUG);
    restoreFixtureFiles([EVENT_FILE]);
  });

  test('event editor shows existing waypoints', async ({ page }) => {
    await loginAs(page, token);

    await page.goto(`/admin/events/${EVENT_SLUG}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Editor loaded
    await expect(page.locator('#event-name')).toHaveValue('BRM 300 Vuelta Rocas');

    // Waypoints section visible
    const waypointSection = page.locator('.waypoint-editor');
    await expect(waypointSection).toBeVisible();

    // Two existing waypoints from fixture
    const rows = waypointSection.locator('.waypoint-row');
    await expect(rows).toHaveCount(2);

    // First waypoint: CP1 Pomaire
    const first = rows.first();
    await expect(first.locator('input[placeholder="Label"]')).toHaveValue('CP1 Pomaire');
    await expect(first.locator('select').first()).toHaveValue('control-pomaire');
    await expect(first.locator('.waypoint-distance')).toHaveValue('85');

    // Checkpoint opening/closing times
    await expect(first.locator('input[type="time"]').first()).toHaveValue('08:30');
    await expect(first.locator('input[type="time"]').nth(1)).toHaveValue('11:40');

    // Note field populated
    await expect(first.locator('.waypoint-note')).toHaveValue('Fill bottles here — next water is 75 km');

    // Second waypoint: CP2 Rapel
    const second = rows.nth(1);
    await expect(second.locator('input[placeholder="Label"]')).toHaveValue('CP2 Rapel');
    await expect(second.locator('select').first()).toHaveValue('control-rapel');
    await expect(second.locator('.waypoint-distance')).toHaveValue('160');
  });

  test('add a new waypoint and save', async ({ page }) => {
    await loginAs(page, token);

    await page.goto(`/admin/events/${EVENT_SLUG}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    const waypointSection = page.locator('.waypoint-editor');

    // Starts with 2 waypoints
    await expect(waypointSection.locator('.waypoint-row')).toHaveCount(2);

    // Click "Add waypoint"
    await waypointSection.locator('button', { hasText: 'Add waypoint' }).click();
    await expect(waypointSection.locator('.waypoint-row')).toHaveCount(3);

    // Fill in the new waypoint (third row)
    const newRow = waypointSection.locator('.waypoint-row').nth(2);

    // Select a place
    await newRow.locator('select').first().selectOption('control-rapel');

    // Change type to POI
    await newRow.locator('select').nth(1).selectOption('poi');

    // Set label
    await newRow.locator('input[placeholder="Label"]').fill('Water Stop Rapel');

    // Set distance
    await newRow.locator('.waypoint-distance').fill('200');

    // POI type should NOT show opening/closing times
    await expect(newRow.locator('input[type="time"]')).toHaveCount(0);

    // Record git HEAD before save
    const headBefore = execSync('git rev-parse HEAD', { cwd: FIXTURE_DIR }).toString().trim();

    // Save
    await page.locator('button.btn-primary', { hasText: 'Save' }).click();
    await expect(page.locator('.save-success')).toBeVisible({ timeout: 10000 });

    // Verify git commit happened
    const headAfter = execSync('git rev-parse HEAD', { cwd: FIXTURE_DIR }).toString().trim();
    expect(headAfter).not.toBe(headBefore);

    // Verify file on disk
    const eventMd = fs.readFileSync(path.join(FIXTURE_DIR, EVENT_FILE), 'utf-8');
    const { data: fm } = matter(eventMd);

    expect(fm.waypoints).toHaveLength(3);

    // Original waypoints preserved
    expect(fm.waypoints[0].place).toBe('control-pomaire');
    expect(fm.waypoints[0].label).toBe('CP1 Pomaire');
    expect(fm.waypoints[0].distance_km).toBe(85);

    // New waypoint saved
    expect(fm.waypoints[2].place).toBe('control-rapel');
    expect(fm.waypoints[2].type).toBe('poi');
    expect(fm.waypoints[2].label).toBe('Water Stop Rapel');
    expect(fm.waypoints[2].distance_km).toBe(200);
  });

  test('remove a waypoint and save', async ({ page }) => {
    await loginAs(page, token);

    await page.goto(`/admin/events/${EVENT_SLUG}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    const waypointSection = page.locator('.waypoint-editor');
    await expect(waypointSection.locator('.waypoint-row')).toHaveCount(2);

    // Remove the first waypoint (CP1 Pomaire)
    await waypointSection.locator('.waypoint-row').first().locator('button', { hasText: 'Remove' }).click();
    await expect(waypointSection.locator('.waypoint-row')).toHaveCount(1);

    // Remaining waypoint should be CP2 Rapel
    await expect(waypointSection.locator('.waypoint-row').first().locator('input[placeholder="Label"]')).toHaveValue('CP2 Rapel');

    // Save
    const headBefore = execSync('git rev-parse HEAD', { cwd: FIXTURE_DIR }).toString().trim();
    await page.locator('button.btn-primary', { hasText: 'Save' }).click();
    await expect(page.locator('.save-success')).toBeVisible({ timeout: 10000 });

    const headAfter = execSync('git rev-parse HEAD', { cwd: FIXTURE_DIR }).toString().trim();
    expect(headAfter).not.toBe(headBefore);

    // Verify file has only one waypoint
    const eventMd = fs.readFileSync(path.join(FIXTURE_DIR, EVENT_FILE), 'utf-8');
    const { data: fm } = matter(eventMd);
    expect(fm.waypoints).toHaveLength(1);
    expect(fm.waypoints[0].place).toBe('control-rapel');
    expect(fm.waypoints[0].label).toBe('CP2 Rapel');
  });

  test('edit waypoint checkpoint times and save', async ({ page }) => {
    await loginAs(page, token);

    await page.goto(`/admin/events/${EVENT_SLUG}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Edit opening/closing times on first waypoint
    const firstRow = page.locator('.waypoint-editor .waypoint-row').first();
    await firstRow.locator('input[type="time"]').first().fill('07:00');
    await firstRow.locator('input[type="time"]').nth(1).fill('12:00');

    // Save
    await page.locator('button.btn-primary', { hasText: 'Save' }).click();
    await expect(page.locator('.save-success')).toBeVisible({ timeout: 10000 });

    // Verify on disk
    const eventMd = fs.readFileSync(path.join(FIXTURE_DIR, EVENT_FILE), 'utf-8');
    const { data: fm } = matter(eventMd);
    expect(fm.waypoints[0].opening).toBe('07:00');
    expect(fm.waypoints[0].closing).toBe('12:00');

    // Second waypoint unchanged
    expect(fm.waypoints[1].opening).toBe('11:00');
    expect(fm.waypoints[1].closing).toBe('16:40');
  });
});

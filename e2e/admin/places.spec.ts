import { test, expect } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import matter from 'gray-matter';
import { FIXTURE_DIR } from './fixture-setup.ts';
import { seedSession, cleanupSession, loginAs, clearContentEdits, cleanupCreatedFiles } from './helpers.ts';

test.describe('Place Creation', () => {
  let token: string;

  test.beforeAll(() => {
    token = seedSession();
  });

  test.beforeEach(() => {
    clearContentEdits('places', 'test-bike-shop');
    cleanupCreatedFiles(['demo/places/test-bike-shop.md']);
  });

  test.afterAll(() => {
    cleanupSession(token);
  });

  test('create new place via API and verify file', async ({ page }) => {
    await loginAs(page, token);

    // Navigate to any admin page to establish session context
    await page.goto('/admin/places');
    await page.waitForLoadState('networkidle');

    const headBefore = execSync('git rev-parse HEAD', { cwd: FIXTURE_DIR }).toString().trim();

    const res = await page.evaluate(async () => {
      const response = await fetch('/api/places/new', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          frontmatter: {
            name: 'Test Bike Shop',
            category: 'bike-shop',
            lat: 45.4215,
            lng: -75.6972,
            address: '123 Main St, Ottawa',
            phone: '613-555-0100',
          },
        }),
      });
      return { status: response.status, body: await response.json() };
    });

    expect(res.status).toBe(200);
    expect(res.body.id).toBe('test-bike-shop');

    // Verify git commit happened
    const headAfter = execSync('git rev-parse HEAD', { cwd: FIXTURE_DIR }).toString().trim();
    expect(headAfter).not.toBe(headBefore);

    // Verify file was created
    const placePath = path.join(FIXTURE_DIR, 'demo/places/test-bike-shop.md');
    expect(fs.existsSync(placePath)).toBe(true);

    const placeMd = fs.readFileSync(placePath, 'utf-8');
    const { data: fm } = matter(placeMd);
    expect(fm.name).toBe('Test Bike Shop');
    expect(fm.category).toBe('bike-shop');
    expect(fm.lat).toBe(45.4215);
    expect(fm.lng).toBe(-75.6972);
    expect(fm.address).toBe('123 Main St, Ottawa');
    expect(fm.phone).toBe('613-555-0100');
  });
});

test.describe('Place Update', () => {
  let token: string;

  test.beforeAll(() => {
    token = seedSession();
  });

  test.beforeEach(() => {
    clearContentEdits('places', 'update-test-cafe');
    cleanupCreatedFiles(['demo/places/update-test-cafe.md']);
  });

  test.afterAll(() => {
    cleanupSession(token);
  });

  test('create then update a place via API', async ({ page }) => {
    await loginAs(page, token);
    await page.goto('/admin/places');
    await page.waitForLoadState('networkidle');

    // Create a place first
    const createRes = await page.evaluate(async () => {
      const response = await fetch('/api/places/new', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          frontmatter: {
            name: 'Update Test Cafe',
            category: 'cafe',
            lat: 45.42,
            lng: -75.69,
            address: '456 Bank St',
          },
        }),
      });
      return { status: response.status, body: await response.json() };
    });

    expect(createRes.status).toBe(200);
    const placeId = createRes.body.id;
    expect(placeId).toBe('update-test-cafe');

    // Now update it
    const headBefore = execSync('git rev-parse HEAD', { cwd: FIXTURE_DIR }).toString().trim();

    const updateRes = await page.evaluate(async (id: string) => {
      const response = await fetch(`/api/places/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          frontmatter: {
            name: 'Updated Cafe',
            category: 'cafe',
            lat: 45.42,
            lng: -75.69,
            address: '789 Bank St',
            website: 'https://updatedcafe.ca',
          },
        }),
      });
      return { status: response.status, body: await response.json() };
    }, placeId);

    expect(updateRes.status).toBe(200);

    // Verify git commit happened
    const headAfter = execSync('git rev-parse HEAD', { cwd: FIXTURE_DIR }).toString().trim();
    expect(headAfter).not.toBe(headBefore);

    // Verify file was updated
    const placePath = path.join(FIXTURE_DIR, `demo/places/${placeId}.md`);
    const placeMd = fs.readFileSync(placePath, 'utf-8');
    const { data: fm } = matter(placeMd);
    expect(fm.name).toBe('Updated Cafe');
    expect(fm.address).toBe('789 Bank St');
    expect(fm.website).toBe('https://updatedcafe.ca');
  });
});

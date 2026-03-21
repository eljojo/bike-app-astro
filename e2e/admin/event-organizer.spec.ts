/**
 * E2E tests for event organizer save logic.
 *
 * Tests the two branches in event-save.ts buildFileChanges():
 * 1. isExistingRef=true — selecting an existing organizer writes the org file + uses slug reference
 * 2. isExistingRef=false with existing org file — always keeps as slug ref + updates org file
 * 3. isExistingRef=false with >0 other refs — organizer stays as slug ref + org file updated
 *
 * Note: inlining + deletion of org files was removed — existing org files are never
 * inlined because adminEvents may be stale (prerendered) and the file may contain
 * fields the inline format can't represent.
 */
import { test, expect } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import matter from 'gray-matter';
import { FIXTURE_DIR } from './fixture-setup.ts';
import {
  seedSession, cleanupSession, loginAs,
  clearContentEdits, restoreFixtureFiles,
} from './helpers.ts';

/** POST to the event save API and return the response. */
async function saveEvent(
  page: import('@playwright/test').Page,
  eventId: string,
  payload: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  return page.evaluate(async ({ eventId, payload }) => {
    const res = await fetch(`/api/events/${eventId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return { status: res.status, body: await res.json() };
  }, { eventId, payload });
}

// ---------------------------------------------------------------------------
// 1. isExistingRef=true — selecting an existing organizer
// ---------------------------------------------------------------------------

test.describe('Organizer — isExistingRef=true', () => {
  let token: string;

  test.beforeAll(() => { token = seedSession(); });
  test.afterAll(() => { cleanupSession(token); });

  test.beforeEach(() => {
    clearContentEdits('events', '2099/event-org-existing');
    restoreFixtureFiles([
      'demo/events/2099/event-org-existing.md',
      'demo/organizers/cycling-club.md',
    ]);
  });

  test('existing organizer selection writes org file and uses slug reference', async ({ page }) => {
    await loginAs(page, token);
    await page.goto('/admin/events/2099/event-org-existing');
    await page.waitForLoadState('networkidle');

    const headBefore = execSync('git rev-parse HEAD', { cwd: FIXTURE_DIR }).toString().trim();

    // Save with isExistingRef=true — simulates selecting an existing organizer
    const response = await saveEvent(page, '2099/event-org-existing', {
      frontmatter: {
        name: 'Org Existing Test',
        start_date: '2099-08-10',
        start_time: '08:00',
        location: 'Central Park',
      },
      body: 'Event for testing isExistingRef=true saves.',
      organizer: {
        slug: 'cycling-club',
        name: 'Demo Cycling Club',
        website: 'https://updated-cycling.example.com',
        isExistingRef: true,
      },
    });

    expect(response.status).toBe(200);

    const headAfter = execSync('git rev-parse HEAD', { cwd: FIXTURE_DIR }).toString().trim();
    expect(headAfter).not.toBe(headBefore);

    // Event frontmatter should have organizer as slug string (not inline object)
    const eventPath = path.join(FIXTURE_DIR, 'demo/events/2099/event-org-existing.md');
    const eventMd = fs.readFileSync(eventPath, 'utf-8');
    const { data: fm } = matter(eventMd);
    expect(fm.organizer).toBe('cycling-club');

    // Organizer file should be updated with the new website
    const orgPath = path.join(FIXTURE_DIR, 'demo/organizers/cycling-club.md');
    const orgMd = fs.readFileSync(orgPath, 'utf-8');
    const { data: orgFm } = matter(orgMd);
    expect(orgFm.name).toBe('Demo Cycling Club');
    expect(orgFm.website).toBe('https://updated-cycling.example.com');
  });
});

// ---------------------------------------------------------------------------
// 2. isExistingRef=false with existing org file — keeps as slug reference
// ---------------------------------------------------------------------------

test.describe('Organizer — isExistingRef=false, existing org file', () => {
  let token: string;

  test.beforeAll(() => { token = seedSession(); });
  test.afterAll(() => { cleanupSession(token); });

  test.beforeEach(() => {
    clearContentEdits('events', '2099/event-org-inline');
    restoreFixtureFiles([
      'demo/events/2099/event-org-inline.md',
      'demo/organizers/solo-organizer.md',
    ]);
  });

  test('existing org file is always kept as slug reference and updated', async ({ page }) => {
    await loginAs(page, token);
    await page.goto('/admin/events/2099/event-org-inline');
    await page.waitForLoadState('networkidle');

    const headBefore = execSync('git rev-parse HEAD', { cwd: FIXTURE_DIR }).toString().trim();

    // Save with isExistingRef=false — even though only this event uses solo-organizer,
    // the org file exists so it's always kept as an external reference
    const response = await saveEvent(page, '2099/event-org-inline', {
      frontmatter: {
        name: 'Org Inline Test',
        start_date: '2099-08-15',
        start_time: '09:00',
        location: 'Riverside',
      },
      body: 'Event for testing isExistingRef=false with existing org file.',
      organizer: {
        slug: 'solo-organizer',
        name: 'Solo Organizer',
        website: 'https://solo-updated.example.com',
        isExistingRef: false,
      },
    });

    expect(response.status).toBe(200);

    const headAfter = execSync('git rev-parse HEAD', { cwd: FIXTURE_DIR }).toString().trim();
    expect(headAfter).not.toBe(headBefore);

    // Event frontmatter should have organizer as slug string (not inlined)
    // because the org file exists — existing files are never inlined
    const eventPath = path.join(FIXTURE_DIR, 'demo/events/2099/event-org-inline.md');
    const eventMd = fs.readFileSync(eventPath, 'utf-8');
    const { data: fm } = matter(eventMd);
    expect(fm.organizer).toBe('solo-organizer');

    // The organizer file should still exist and be updated
    const orgPath = path.join(FIXTURE_DIR, 'demo/organizers/solo-organizer.md');
    expect(fs.existsSync(orgPath)).toBe(true);
    const orgMd = fs.readFileSync(orgPath, 'utf-8');
    const { data: orgFm } = matter(orgMd);
    expect(orgFm.name).toBe('Solo Organizer');
    expect(orgFm.website).toBe('https://solo-updated.example.com');
  });
});

// ---------------------------------------------------------------------------
// 3. isExistingRef=false with >0 other refs — stays as slug reference
// ---------------------------------------------------------------------------

test.describe('Organizer — isExistingRef=false, has other refs', () => {
  let token: string;

  test.beforeAll(() => { token = seedSession(); });
  test.afterAll(() => { cleanupSession(token); });

  test.beforeEach(() => {
    clearContentEdits('events', '2099/event-org-shared-a');
    restoreFixtureFiles([
      'demo/events/2099/event-org-shared-a.md',
      'demo/events/2099/event-org-shared-b.md',
      'demo/organizers/shared-org.md',
    ]);
  });

  test('new organizer with other refs stays as slug reference and updates org file', async ({ page }) => {
    await loginAs(page, token);
    await page.goto('/admin/events/2099/event-org-shared-a');
    await page.waitForLoadState('networkidle');

    const headBefore = execSync('git rev-parse HEAD', { cwd: FIXTURE_DIR }).toString().trim();

    // Save event-org-shared-a with isExistingRef=false
    // event-org-shared-b also uses shared-org, so otherRefs > 0
    const response = await saveEvent(page, '2099/event-org-shared-a', {
      frontmatter: {
        name: 'Org Shared A',
        start_date: '2099-09-01',
        start_time: '07:00',
        location: 'North Trail',
      },
      body: 'First event using shared-org.',
      organizer: {
        slug: 'shared-org',
        name: 'Shared Org Updated',
        website: 'https://shared-updated.example.com',
        isExistingRef: false,
      },
    });

    expect(response.status).toBe(200);

    const headAfter = execSync('git rev-parse HEAD', { cwd: FIXTURE_DIR }).toString().trim();
    expect(headAfter).not.toBe(headBefore);

    // Event frontmatter should have organizer as slug string (NOT inlined)
    // because another event also references this organizer
    const eventPath = path.join(FIXTURE_DIR, 'demo/events/2099/event-org-shared-a.md');
    const eventMd = fs.readFileSync(eventPath, 'utf-8');
    const { data: fm } = matter(eventMd);
    expect(fm.organizer).toBe('shared-org');

    // The organizer file should still exist and be updated
    const orgPath = path.join(FIXTURE_DIR, 'demo/organizers/shared-org.md');
    expect(fs.existsSync(orgPath)).toBe(true);
    const orgMd = fs.readFileSync(orgPath, 'utf-8');
    const { data: orgFm } = matter(orgMd);
    expect(orgFm.name).toBe('Shared Org Updated');
    expect(orgFm.website).toBe('https://shared-updated.example.com');

    // Verify event-org-shared-b was not affected
    const eventBPath = path.join(FIXTURE_DIR, 'demo/events/2099/event-org-shared-b.md');
    const eventBMd = fs.readFileSync(eventBPath, 'utf-8');
    const { data: fmB } = matter(eventBMd);
    expect(fmB.organizer).toBe('shared-org');
  });
});

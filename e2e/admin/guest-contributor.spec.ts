/**
 * Reproduction tests for the "first-time contributor gets blocked" incident.
 *
 * Two real users reported, in the same week, that adding an event as a brand-new
 * visitor failed in a cluster of ways. This spec reproduces each reported failure
 * from the perspective that actually triggers it: a TRULY ANONYMOUS visitor (no
 * session cookie) or a GUEST (role=guest session, the `cyclist-XXXX` identity).
 *
 * Every existing admin spec seeds an admin/editor session before acting, which is
 * exactly why these bugs reached production — the anonymous/guest path is never
 * exercised. Each test below asserts the CORRECT behavior, so it fails (RED)
 * against current code. That failure is the confirmation of the root cause.
 *
 * Symptom map (see investigation):
 *   A — media/poster upload returns "Unauthorized" for a visitor with no session
 *   B — a guest is stuck as `cyclist-XXXX` with no way to set a profile
 *   C — the "Create an account" link is a dead end (bounces back to /admin)
 *   D — the community-creation page is not reachable anonymously (events are)
 *   E — an accidental resubmit silently creates a `-2` duplicate event
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { FIXTURE_DIR } from './fixture-setup.ts';
import {
  seedSession,
  cleanupSession,
  loginAs,
  waitForHydration,
  cleanupCreatedFiles,
  clearContentEdits,
} from './helpers.ts';

test.describe('Guest contributor — poster upload (Symptom A)', () => {
  test('anonymous visitor selecting a poster is bootstrapped to a guest, no "Unauthorized"', async ({ page }) => {
    // No loginAs(): a brand-new visitor with no session cookie.
    await page.goto('/admin/events/new');
    await page.waitForLoadState('networkidle');
    await waitForHydration(page);

    // Start the wizard and land on the poster step.
    await page.locator('.wizard-welcome button.btn-primary').click();
    await expect(page.locator('.wizard-step-heading')).toContainText('poster');

    // Select a real 1x1 PNG (valid so confirm can read dimensions).
    const onePxPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      'base64',
    );
    await page.locator('input[type="file"]').setInputFiles({
      name: 'poster.png',
      mimeType: 'image/png',
      buffer: onePxPng,
    });

    // The upload now bootstraps a guest (logged_in cookie) and shows no auth error.
    await expect(page.locator('.auth-error')).toHaveCount(0);
    await expect.poll(async () =>
      (await page.context().cookies()).some((c) => c.name === 'logged_in'),
    ).toBe(true);
  });
});

// -------------------------------------------------------------------------
// Symptom B — a guest cannot change their `cyclist-XXXX` identity
// -------------------------------------------------------------------------
test.describe('Guest contributor — profile (Symptom B)', () => {
  let guestToken: string;

  test.beforeAll(() => {
    guestToken = seedSession({ role: 'guest', username: 'cyclist-35ad', email: null });
  });
  test.afterAll(() => {
    cleanupSession(guestToken);
  });

  test('guest can change their display name on the settings page', async ({ page }) => {
    await loginAs(page, guestToken);
    await page.goto('/admin/settings');
    await page.waitForLoadState('networkidle');
    await waitForHydration(page);

    // BUG: the settings page hides every profile field from guests and shows
    // only a paragraph + dead-end link, so there is no control to stop being
    // "forever cyclist-35ad". The backend (settings.ts) would accept the change.
    const usernameInput = page.locator('#settings-username');
    await expect(usernameInput, 'guest should have a way to set their name').toBeVisible();
  });
});

// -------------------------------------------------------------------------
// Symptom C — "Create an account" is a dead end for a guest
// -------------------------------------------------------------------------
test.describe('Guest contributor — account creation link (Symptom C)', () => {
  let guestToken: string;

  test.beforeAll(() => {
    guestToken = seedSession({ role: 'guest', username: 'cyclist-e34d', email: null });
  });
  test.afterAll(() => {
    cleanupSession(guestToken);
  });

  test('guest who clicks "Create an account" reaches an account form, not /admin', async ({ page }) => {
    await loginAs(page, guestToken);
    await page.goto('/admin/settings');
    await page.waitForLoadState('networkidle');
    await waitForHydration(page);

    // The only account-creation affordance the guest is given on this page.
    await page.getByRole('link', { name: /create an account/i }).click();
    await page.waitForLoadState('networkidle');

    // BUG: the link points at /login, and login.astro redirects any visitor who
    // already has a session (every guest does) straight back to /admin — so the
    // "new page to edit" never appears.
    expect(page.url(), 'guest should not be bounced back to /admin').not.toContain('/admin');
    await expect(
      page.locator('#upgrade-email, #login-email'),
      'guest should reach a form to set an email/username',
    ).toBeVisible();
  });
});

// -------------------------------------------------------------------------
// Symptom D — community creation is unreachable anonymously
// -------------------------------------------------------------------------
// /admin/events/new and /admin/routes/* are browsable anonymously (first-time
// contributors land straight on the wizard). /admin/community-new is NOT in the
// middleware's browsable list, so an anonymous visitor is redirected to /login.
test.describe('Guest contributor — add a community (Symptom D)', () => {
  test('anonymous visitor can reach the community creation wizard', async ({ page }) => {
    await page.goto('/admin/community-new');
    await page.waitForLoadState('networkidle');

    // BUG: redirected to /login, unlike the event/route editors.
    expect(page.url(), 'community creation should be reachable like events').not.toContain('/login');
  });
});

// -------------------------------------------------------------------------
// Symptom E — accidental resubmit silently creates a `-2` duplicate
// -------------------------------------------------------------------------
// The form_instance_id duplicate guard is minted once per form MOUNT. A reload
// or re-navigation (very likely after the confusing upload failure) mints a new
// id, defeating the guard. event-save's slug-collision handler then silently
// allocates `-2` instead of recognizing the resubmission — two events appear.
test.describe('Guest contributor — duplicate event (Symptom E)', () => {
  let guestToken: string;
  const YEAR = '2099';
  const SLUG = 'velo-fridays-womens-clinic';
  const ID = `${YEAR}/${SLUG}`;

  test.beforeAll(() => {
    guestToken = seedSession({ role: 'guest', username: 'cyclist-velo', email: null });
  });
  test.afterAll(() => {
    cleanupSession(guestToken);
  });

  test.beforeEach(() => {
    cleanupCreatedFiles([
      `demo/events/${YEAR}/${SLUG}.md`,
      `demo/events/${YEAR}/${SLUG}`,
      `demo/events/${YEAR}/${SLUG}-2.md`,
      `demo/events/${YEAR}/${SLUG}-2`,
    ]);
    clearContentEdits('events', ID);
    clearContentEdits('events', `${ID}-2`);
  });

  test('resubmitting the same new event from a fresh form mount creates no duplicate', async ({ page }) => {
    await loginAs(page, guestToken);
    await page.goto('/admin/events/new');
    await page.waitForLoadState('networkidle');

    const payload = (formInstanceId: string) => ({
      frontmatter: { name: 'Velo-Fridays Women’s Cycling Clinic', start_date: `${YEAR}-05-08` },
      body: 'Women’s cycling clinic, every Friday.',
      slug: SLUG,
      form_instance_id: formInstanceId,
    });

    const post = (p: ReturnType<typeof payload>) =>
      page.evaluate(async (pp) => {
        const res = await fetch('/api/events/new', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(pp),
        });
        return { status: res.status, body: await res.json() };
      }, p);

    // First submission — creates the event.
    const r1 = await post(payload('mount-A'));
    expect(r1.status).toBe(200);
    expect(r1.body.id).toBe(ID);

    // Second submission from a DIFFERENT mount — simulates the reload/re-nav the
    // user did after the poster upload failed. A new form_instance_id bypasses
    // the per-mount guard.
    await post(payload('mount-B'));

    // BUG: a `-2` sibling event file now exists — the event was "posted twice".
    const dupFlat = path.join(FIXTURE_DIR, 'demo/events', YEAR, `${SLUG}-2.md`);
    const dupDir = path.join(FIXTURE_DIR, 'demo/events', YEAR, `${SLUG}-2`, 'index.md');
    expect(fs.existsSync(dupFlat) || fs.existsSync(dupDir), 'no -2 duplicate should be created').toBe(false);
  });
});

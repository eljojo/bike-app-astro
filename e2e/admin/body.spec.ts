import { test, expect } from '@playwright/test';
import { seedSession, cleanupSession, loginAs, waitForHydration } from './helpers.ts';

test.describe('Admin Route Editor', () => {
  let token: string;

  test.beforeAll(() => {
    token = seedSession();
  });

  test.afterAll(() => {
    cleanupSession(token);
  });

  // Regression test: Preact hydration removes textarea text children without
  // setting the value property, causing the body field to appear empty.
  // Fixed by adding a useEffect in RouteEditor to re-apply the value on mount.
  //
  // TODO: investigate whether this is a Preact bug worth reporting upstream.
  // The root cause is in preact/src/diff/index.js — the `value` prop is
  // guarded by `if (!isHydrating)`, so it's never applied during hydrate().
  // Child diffing then removes the SSR text nodes, clearing the textarea.
  // Consider opening a PR against preactjs/preact.
  test('body textarea retains content after Preact hydration', async ({ page }) => {
    await loginAs(page, token);

    await page.goto('/admin/routes/carp');
    await page.waitForLoadState('networkidle');

    // Verify we landed on the editor (not redirected to gate)
    await expect(page.locator('#route-name')).toBeVisible({ timeout: 10000 });

    const textarea = page.locator('#route-body');
    await expect(textarea).toBeVisible({ timeout: 10000 });

    await waitForHydration(page);

    const value = await textarea.inputValue();
    expect(value).toContain('Carp is a rural community');
    expect(value.length).toBeGreaterThan(50);
  });

});

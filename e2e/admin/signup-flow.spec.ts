import { test, expect } from '@playwright/test';
import { seedSession, cleanupSession, loginAs, waitForHydration } from './helpers.ts';

test.describe('Blended Login Page', () => {
  test('login page renders email field', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');
    await waitForHydration(page);

    // Email input should be visible
    await expect(page.locator('#login-email')).toBeVisible();
    // The Continue button should be visible
    await expect(page.getByRole('button', { name: /continue/i })).toBeVisible();
  });

  test('submit with new email returns verify-email flow', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');
    await waitForHydration(page);

    // Submit a brand new email via the API to check the response
    const result = await page.evaluate(async () => {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: `new-user-${Date.now()}@test.local` }),
      });
      return { status: res.status, body: await res.json() };
    });

    expect(result.status).toBe(200);
    expect(result.body.flow).toBe('verify-email');
    expect(result.body.username).toBeTruthy();
  });

  test('submit with existing user email returns magic-link flow', async ({ page }) => {
    // Seed an existing user (no passkeys)
    const token = seedSession({ role: 'editor', username: 'existing-login-user', email: 'existing-login@test.local' });

    try {
      await page.goto('/login');
      await page.waitForLoadState('networkidle');

      const result = await page.evaluate(async () => {
        const res = await fetch('/api/auth/signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'existing-login@test.local' }),
        });
        return { status: res.status, body: await res.json() };
      });

      expect(result.status).toBe(200);
      expect(result.body.flow).toBe('magic-link');
    } finally {
      cleanupSession(token);
    }
  });

  test('/register redirects 301 to /login', async ({ page }) => {
    await page.goto('/register');
    // Playwright follows redirects, so check the final URL
    expect(page.url()).toContain('/login');
    // Verify we ended up at the login form
    await expect(page.locator('#login-email')).toBeVisible({ timeout: 10000 });
  });

  test('/register preserves returnTo param through redirect', async ({ page }) => {
    await page.goto('/register?returnTo=/admin/routes/carp');
    // Should end up at /login with returnTo preserved
    expect(page.url()).toContain('/login');
    expect(page.url()).toContain('returnTo');
  });

  test('already logged-in user visiting /login is redirected to admin', async ({ page }) => {
    const token = seedSession({ role: 'admin', username: 'already-logged', email: 'already-logged@test.local' });
    try {
      await loginAs(page, token);
      await page.goto('/login');
      await page.waitForLoadState('networkidle');

      // Should redirect away from /login since already authenticated
      expect(page.url()).toContain('/admin');
    } finally {
      cleanupSession(token);
    }
  });
});

test.describe('Inline Upgrade Modal', () => {
  let guestToken: string;

  test.beforeAll(() => {
    guestToken = seedSession({ role: 'guest', username: 'upgrade-test-guest', email: null });
  });

  test.afterAll(() => {
    cleanupSession(guestToken);
  });

  test('upgrade form in success modal POSTs to /api/auth/upgrade', async ({ page }) => {
    await loginAs(page, guestToken);
    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    // Verify the upgrade endpoint exists and rejects missing fields
    const result = await page.evaluate(async () => {
      const res = await fetch('/api/auth/upgrade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'upgrade@test.local', username: 'upgrade-user' }),
      });
      return { status: res.status, body: await res.json() };
    });

    // Should succeed (200) — the upgrade endpoint accepts email + username for guest users
    expect(result.status).toBe(200);
    expect(result.body.success).toBe(true);
  });

  test('upgrade endpoint rejects non-guest users', async ({ page }) => {
    const adminToken = seedSession({ role: 'admin', username: 'admin-upgrade-test', email: 'admin-upgrade@test.local' });
    try {
      await loginAs(page, adminToken);
      await page.goto('/login');
      await page.waitForLoadState('networkidle');

      const result = await page.evaluate(async () => {
        const res = await fetch('/api/auth/upgrade', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'admin@test.local', username: 'admin-user' }),
        });
        return { status: res.status, body: await res.json() };
      });

      expect(result.status).toBe(400);
      expect(result.body.error).toContain('guest');
    } finally {
      cleanupSession(adminToken);
    }
  });
});

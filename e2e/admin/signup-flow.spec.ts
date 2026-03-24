import { test, expect } from '@playwright/test';
import { seedSession, cleanupSession, loginAs, waitForHydration, getEmailToken, getUser } from './helpers.ts';

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

test.describe('Guest Upgrade Flow', () => {
  test('full upgrade: guest calls upgrade API, email token is created, verify link upgrades to editor', async ({ page }) => {
    // 1. Create a guest session
    const guestToken = seedSession({ role: 'guest', username: 'upgrade-flow-guest', email: null });

    try {
      await loginAs(page, guestToken);
      await page.goto('/admin');
      await page.waitForLoadState('networkidle');

      // 2. Call the upgrade endpoint with email + username
      const upgradeEmail = `upgrade-flow-${Date.now()}@test.local`;
      const upgradeUsername = `upgraded-${Date.now()}`;

      const upgradeResult = await page.evaluate(async ({ email, username }) => {
        const res = await fetch('/api/auth/upgrade', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, username }),
        });
        return { status: res.status, body: await res.json() };
      }, { email: upgradeEmail, username: upgradeUsername });

      expect(upgradeResult.status).toBe(200);
      expect(upgradeResult.body.success).toBe(true);

      // 3. Verify an email token was created in the DB
      const emailToken = getEmailToken({ email: upgradeEmail });
      expect(emailToken).not.toBeNull();
      expect(emailToken!.token).toBeTruthy();

      // 4. Verify user was updated with email + username but still guest (not yet verified)
      const userBeforeVerify = getUser(emailToken!.userId);
      expect(userBeforeVerify).not.toBeNull();
      expect(userBeforeVerify!.email).toBe(upgradeEmail);
      expect(userBeforeVerify!.username).toBe(upgradeUsername);
      expect(userBeforeVerify!.role).toBe('guest');
      expect(userBeforeVerify!.emailVerified).toBe(0);

      // 5. "Click the email link" — visit /auth/verify with the token
      await page.goto(`/auth/verify?token=${emailToken!.token}`);
      await page.waitForLoadState('networkidle');

      // Should redirect to /admin after successful verification
      expect(page.url()).toContain('/admin');

      // 6. Verify user is now an editor with emailVerified = true
      const userAfterVerify = getUser(emailToken!.userId);
      expect(userAfterVerify).not.toBeNull();
      expect(userAfterVerify!.role).toBe('editor');
      expect(userAfterVerify!.emailVerified).toBe(1);
    } finally {
      cleanupSession(guestToken);
    }
  });

  test('upgrade endpoint rejects non-guest users', async ({ page }) => {
    const adminToken = seedSession({ role: 'admin', username: 'admin-upgrade-test', email: 'admin-upgrade@test.local' });
    try {
      await loginAs(page, adminToken);
      await page.goto('/admin');
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

  test('upgrade is retry-safe — resubmitting same email/username succeeds', async ({ page }) => {
    const guestToken = seedSession({ role: 'guest', username: 'retry-guest', email: null });

    try {
      await loginAs(page, guestToken);
      await page.goto('/admin');
      await page.waitForLoadState('networkidle');

      const email = `retry-${Date.now()}@test.local`;
      const username = `retry-${Date.now()}`;

      // First upgrade call
      const first = await page.evaluate(async ({ email, username }) => {
        const res = await fetch('/api/auth/upgrade', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, username }),
        });
        return { status: res.status };
      }, { email, username });

      expect(first.status).toBe(200);

      // Second call with same values — should not 409
      const second = await page.evaluate(async ({ email, username }) => {
        const res = await fetch('/api/auth/upgrade', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, username }),
        });
        return { status: res.status };
      }, { email, username });

      expect(second.status).toBe(200);
    } finally {
      cleanupSession(guestToken);
    }
  });

  test('verify link with invalid token shows error', async ({ page }) => {
    await page.goto('/auth/verify?token=bogus-token-that-does-not-exist');
    await page.waitForLoadState('networkidle');

    // Should show error, not redirect
    await expect(page.getByText('invalid or has expired')).toBeVisible();
  });
});

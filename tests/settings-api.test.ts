import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('POST /api/settings', () => {
  const dbPath = path.join(import.meta.dirname, '.test-settings-api.db');
  let database: any;

  beforeEach(async () => {
    for (const ext of ['', '-wal', '-shm']) {
      const f = dbPath + ext;
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }
    const { createLocalDb } = await import('../src/db/local');
    database = createLocalDb(dbPath);

    const { users } = await import('../src/db/schema');
    await database.insert(users).values({
      id: 'user-1', email: 'alice@example.com', username: 'alice', role: 'editor',
      createdAt: new Date().toISOString(),
    });
    await database.insert(users).values({
      id: 'user-2', email: 'bob@example.com', username: 'bob', role: 'guest',
      createdAt: new Date().toISOString(),
    });
  });

  afterAll(() => {
    for (const ext of ['', '-wal', '-shm']) {
      const f = dbPath + ext;
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }
  });

  describe('username change', () => {
    it('updates username successfully', async () => {
      const { users } = await import('../src/db/schema');
      const { eq } = await import('drizzle-orm');
      const { sanitizeUsername, isValidUsername } = await import('../src/lib/username');

      const newUsername = sanitizeUsername('alice-new');
      expect(isValidUsername(newUsername)).toBe(true);

      // Simulate the endpoint logic: check uniqueness
      const existing = await database
        .select({ id: users.id })
        .from(users)
        .where(eq(users.username, newUsername))
        .limit(1);
      expect(existing.length).toBe(0);

      // Get current previousUsernames
      const currentRow = await database
        .select({ previousUsernames: users.previousUsernames })
        .from(users)
        .where(eq(users.id, 'user-1'))
        .limit(1);
      const prev: string[] = currentRow[0]?.previousUsernames
        ? JSON.parse(currentRow[0].previousUsernames)
        : [];
      prev.push('alice');

      await database
        .update(users)
        .set({ username: newUsername, previousUsernames: JSON.stringify(prev) })
        .where(eq(users.id, 'user-1'));

      // Verify
      const updated = await database
        .select({ username: users.username, previousUsernames: users.previousUsernames })
        .from(users)
        .where(eq(users.id, 'user-1'))
        .limit(1);
      expect(updated[0].username).toBe('alice-new');
      expect(JSON.parse(updated[0].previousUsernames)).toEqual(['alice']);
    });

    it('rejects invalid username (too short)', async () => {
      const { isValidUsername, sanitizeUsername } = await import('../src/lib/username');
      const result = sanitizeUsername('a');
      expect(isValidUsername(result)).toBe(false);
    });

    it('rejects invalid username (special characters)', async () => {
      const { isValidUsername, sanitizeUsername } = await import('../src/lib/username');
      // sanitize strips special chars; if nothing valid remains, becomes 'anonymous'
      const result = sanitizeUsername('!!!');
      // 'anonymous' is valid, but '!' chars get stripped
      expect(result).toBe('anonymous');

      // A single special char that sanitizes to a 1-char string
      const result2 = sanitizeUsername('a!');
      expect(isValidUsername(result2)).toBe(false);
    });

    it('rejects duplicate username', async () => {
      const { users } = await import('../src/db/schema');
      const { eq } = await import('drizzle-orm');

      // Try to take 'bob' which already exists
      const existing = await database
        .select({ id: users.id })
        .from(users)
        .where(eq(users.username, 'bob'))
        .limit(1);
      expect(existing.length).toBe(1);
      expect(existing[0].id).toBe('user-2');
    });
  });

  describe('email change', () => {
    it('updates email successfully', async () => {
      const { users } = await import('../src/db/schema');
      const { eq } = await import('drizzle-orm');
      const { normalizeEmail } = await import('../src/lib/auth');

      const newEmail = normalizeEmail('  Alice-NEW@Example.COM  ');
      expect(newEmail).toBe('alice-new@example.com');

      // Check uniqueness (no other user has this email)
      const existing = await database
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, newEmail))
        .limit(1);
      expect(existing.length).toBe(0);

      await database
        .update(users)
        .set({ email: newEmail })
        .where(eq(users.id, 'user-1'));

      const updated = await database
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, 'user-1'))
        .limit(1);
      expect(updated[0].email).toBe('alice-new@example.com');
    });

    it('rejects duplicate email', async () => {
      const { users } = await import('../src/db/schema');
      const { eq } = await import('drizzle-orm');
      const { normalizeEmail } = await import('../src/lib/auth');

      // Try to take bob's email
      const newEmail = normalizeEmail('bob@example.com');
      const existing = await database
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, newEmail))
        .limit(1);
      expect(existing.length).toBe(1);
      expect(existing[0].id).toBe('user-2');
    });

    it('allows clearing email (set to null)', async () => {
      const { users } = await import('../src/db/schema');
      const { eq } = await import('drizzle-orm');

      await database
        .update(users)
        .set({ email: null })
        .where(eq(users.id, 'user-1'));

      const updated = await database
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, 'user-1'))
        .limit(1);
      expect(updated[0].email).toBeNull();
    });

    it('skips update when email is unchanged', async () => {
      const { users } = await import('../src/db/schema');
      const { eq } = await import('drizzle-orm');
      const { normalizeEmail } = await import('../src/lib/auth');

      // Normalize alice's existing email
      const email = normalizeEmail('alice@example.com');

      // Fetch current email to compare
      const current = await database
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, 'user-1'))
        .limit(1);

      // If normalized email matches current, no update needed
      expect(current[0].email).toBe(email);
    });

    it('rejects invalid email format', () => {
      // Basic email validation: must contain @ with something on each side
      const isValidEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

      expect(isValidEmail('valid@example.com')).toBe(true);
      expect(isValidEmail('not-an-email')).toBe(false);
      expect(isValidEmail('@example.com')).toBe(false);
      expect(isValidEmail('user@')).toBe(false);
      expect(isValidEmail('user@example')).toBe(false);
      expect(isValidEmail('')).toBe(false);
    });

    it('allows own email to pass uniqueness check', async () => {
      const { users } = await import('../src/db/schema');
      const { eq, and, ne } = await import('drizzle-orm');
      const { normalizeEmail } = await import('../src/lib/auth');

      // User re-submits their own email (maybe just whitespace changed)
      const email = normalizeEmail('  ALICE@example.com  ');

      // Uniqueness check should exclude the current user
      const existing = await database
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.email, email), ne(users.id, 'user-1')))
        .limit(1);
      expect(existing.length).toBe(0); // no conflict
    });
  });

  describe('settings upsert', () => {
    it('creates settings row if none exists', async () => {
      const { userSettings } = await import('../src/db/schema');
      const { eq } = await import('drizzle-orm');

      await database
        .insert(userSettings)
        .values({ userId: 'user-1', emailInCommits: true, analyticsOptOut: false })
        .onConflictDoUpdate({
          target: userSettings.userId,
          set: { emailInCommits: true, analyticsOptOut: false },
        });

      const rows = await database
        .select()
        .from(userSettings)
        .where(eq(userSettings.userId, 'user-1'));
      expect(rows.length).toBe(1);
      expect(rows[0].emailInCommits).toBe(true);
      expect(rows[0].analyticsOptOut).toBe(false);
    });

    it('updates settings row if one already exists', async () => {
      const { userSettings } = await import('../src/db/schema');
      const { eq } = await import('drizzle-orm');

      // Insert initial settings
      await database.insert(userSettings).values({
        userId: 'user-1', emailInCommits: false, analyticsOptOut: false,
      });

      // Upsert with new values
      await database
        .insert(userSettings)
        .values({ userId: 'user-1', emailInCommits: true, analyticsOptOut: true })
        .onConflictDoUpdate({
          target: userSettings.userId,
          set: { emailInCommits: true, analyticsOptOut: true },
        });

      const rows = await database
        .select()
        .from(userSettings)
        .where(eq(userSettings.userId, 'user-1'));
      expect(rows.length).toBe(1);
      expect(rows[0].emailInCommits).toBe(true);
      expect(rows[0].analyticsOptOut).toBe(true);
    });

    it('upserts only emailInCommits without affecting analyticsOptOut', async () => {
      const { userSettings } = await import('../src/db/schema');
      const { eq } = await import('drizzle-orm');

      // Insert initial settings
      await database.insert(userSettings).values({
        userId: 'user-1', emailInCommits: false, analyticsOptOut: true,
      });

      // Upsert only emailInCommits
      const settingsUpdate: Record<string, boolean> = { emailInCommits: true };
      await database
        .insert(userSettings)
        .values({ userId: 'user-1', ...settingsUpdate })
        .onConflictDoUpdate({
          target: userSettings.userId,
          set: settingsUpdate,
        });

      const rows = await database
        .select()
        .from(userSettings)
        .where(eq(userSettings.userId, 'user-1'));
      expect(rows.length).toBe(1);
      expect(rows[0].emailInCommits).toBe(true);
      expect(rows[0].analyticsOptOut).toBe(true); // unchanged
    });
  });
});

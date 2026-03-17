import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const testUser = {
  id: 'user-1',
  username: 'alice',
  email: 'alice@example.com',
  role: 'editor' as const,
  bannedAt: null,
  emailInCommits: false,
  analyticsOptOut: false,
};

vi.mock('../src/lib/auth/authorize', () => ({
  authorize: () => testUser,
}));

let database: any;
vi.mock('../src/lib/get-db', () => ({
  db: () => database,
}));

describe('POST /api/settings', () => {
  const dbPath = path.join(import.meta.dirname, '.test-settings-api.db');

  beforeEach(async () => {
    for (const ext of ['', '-wal', '-shm']) {
      const f = dbPath + ext;
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }
    const { createLocalDb } = await import('../src/db/local');
    database = createLocalDb(dbPath);

    const { users } = await import('../src/db/schema');
    await database.insert(users).values({
      id: 'user-1',
      email: 'alice@example.com',
      username: 'alice',
      role: 'editor',
      createdAt: new Date().toISOString(),
    });
    await database.insert(users).values({
      id: 'user-2',
      email: 'bob@example.com',
      username: 'bob',
      role: 'guest',
      createdAt: new Date().toISOString(),
    });

    // Reset testUser state between tests
    testUser.username = 'alice';
    testUser.email = 'alice@example.com';
  });

  afterAll(() => {
    for (const ext of ['', '-wal', '-shm']) {
      const f = dbPath + ext;
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }
  });

  async function callSettings(body: Record<string, unknown>) {
    const { POST } = await import('../src/views/api/settings');
    const request = new Request('http://localhost/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return POST({ request, locals: { user: testUser } } as any);
  }

  describe('username change', () => {
    it('updates username successfully', async () => {
      const res = await callSettings({ username: 'alice-new' });
      expect(res.status).toBe(200);

      const { users } = await import('../src/db/schema');
      const { eq } = await import('drizzle-orm');
      const row = await database.select().from(users).where(eq(users.id, 'user-1'));
      expect(row[0].username).toBe('alice-new');
      expect(JSON.parse(row[0].previousUsernames)).toEqual(['alice']);
    });

    it('rejects invalid username (too short)', async () => {
      const res = await callSettings({ username: 'a' });
      const body = await res.json();
      expect(res.status).toBe(400);
      expect(body.error).toContain('Invalid username');
    });

    it('rejects duplicate username', async () => {
      const res = await callSettings({ username: 'bob' });
      const body = await res.json();
      expect(res.status).toBe(400);
      expect(body.error).toContain('already taken');
    });

    it('skips update when username is unchanged', async () => {
      const res = await callSettings({ username: 'alice' });
      expect(res.status).toBe(200);

      const { users } = await import('../src/db/schema');
      const { eq } = await import('drizzle-orm');
      const row = await database.select().from(users).where(eq(users.id, 'user-1'));
      expect(row[0].username).toBe('alice');
      expect(row[0].previousUsernames).toBeNull();
    });
  });

  describe('email change', () => {
    it('updates email successfully', async () => {
      const res = await callSettings({ email: 'new@example.com' });
      expect(res.status).toBe(200);

      const { users } = await import('../src/db/schema');
      const { eq } = await import('drizzle-orm');
      const row = await database.select().from(users).where(eq(users.id, 'user-1'));
      expect(row[0].email).toBe('new@example.com');
    });

    it('rejects empty email', async () => {
      const res = await callSettings({ email: '' });
      const body = await res.json();
      expect(res.status).toBe(400);
      expect(body.error).toContain('empty');
    });

    it('rejects invalid email format', async () => {
      const res = await callSettings({ email: 'not-an-email' });
      const body = await res.json();
      expect(res.status).toBe(400);
      expect(body.error).toContain('Invalid email');
    });

    it('rejects duplicate email', async () => {
      const res = await callSettings({ email: 'bob@example.com' });
      const body = await res.json();
      expect(res.status).toBe(400);
      expect(body.error).toContain('already in use');
    });

    it('skips update when email is unchanged', async () => {
      // Submitting same email (with whitespace) should succeed without conflict
      const res = await callSettings({ email: '  ALICE@example.com  ' });
      expect(res.status).toBe(200);

      const { users } = await import('../src/db/schema');
      const { eq } = await import('drizzle-orm');
      const row = await database.select().from(users).where(eq(users.id, 'user-1'));
      expect(row[0].email).toBe('alice@example.com');
    });
  });

  describe('settings upsert', () => {
    it('creates settings row with emailInCommits', async () => {
      const res = await callSettings({ emailInCommits: true });
      expect(res.status).toBe(200);

      const { userSettings } = await import('../src/db/schema');
      const { eq } = await import('drizzle-orm');
      const rows = await database.select().from(userSettings).where(eq(userSettings.userId, 'user-1'));
      expect(rows).toHaveLength(1);
      expect(rows[0].emailInCommits).toBe(true);
    });

    it('upserts without duplicating rows', async () => {
      await callSettings({ emailInCommits: true });
      await callSettings({ emailInCommits: false });

      const { userSettings } = await import('../src/db/schema');
      const { eq } = await import('drizzle-orm');
      const rows = await database.select().from(userSettings).where(eq(userSettings.userId, 'user-1'));
      expect(rows).toHaveLength(1);
      expect(rows[0].emailInCommits).toBe(false);
    });

    it('upserts only the provided setting', async () => {
      // Set both initially
      await callSettings({ emailInCommits: false, analyticsOptOut: true });

      // Update only emailInCommits
      await callSettings({ emailInCommits: true });

      const { userSettings } = await import('../src/db/schema');
      const { eq } = await import('drizzle-orm');
      const rows = await database.select().from(userSettings).where(eq(userSettings.userId, 'user-1'));
      expect(rows).toHaveLength(1);
      expect(rows[0].emailInCommits).toBe(true);
      expect(rows[0].analyticsOptOut).toBe(true); // unchanged
    });
  });
});

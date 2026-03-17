import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { normalizeEmail, generateId, getWebAuthnConfig, findUserByIdentifier } from '../src/lib/auth/auth';

describe('auth helpers', () => {
  describe('normalizeEmail', () => {
    it('lowercases email', () => {
      expect(normalizeEmail('User@Example.COM')).toBe('user@example.com');
    });

    it('trims whitespace', () => {
      expect(normalizeEmail('  user@example.com  ')).toBe('user@example.com');
    });

    it('handles already-normalized email', () => {
      expect(normalizeEmail('user@example.com')).toBe('user@example.com');
    });
  });

  describe('generateId', () => {
    it('returns a 32-character hex string', () => {
      const id = generateId();
      expect(id).toMatch(/^[0-9a-f]{32}$/);
    });

    it('generates unique IDs', () => {
      const ids = new Set(Array.from({ length: 100 }, () => generateId()));
      expect(ids.size).toBe(100);
    });
  });

  describe('getWebAuthnConfig', () => {
    it('derives rpID and origin from request URL', () => {
      const config = getWebAuthnConfig('https://new.ottawabybike.ca/api/auth/register');
      expect(config.rpID).toBe('new.ottawabybike.ca');
      expect(config.rpName).toBe('whereto-bike');
      expect(config.origin).toBe('https://new.ottawabybike.ca');
    });

    it('works with localhost dev server', () => {
      const config = getWebAuthnConfig('http://localhost:4321/api/auth/register');
      expect(config.rpID).toBe('localhost');
      expect(config.origin).toBe('http://localhost:4321');
    });

    it('env vars override derived values', () => {
      const config = getWebAuthnConfig('https://new.ottawabybike.ca/api/auth/register', {
        WEBAUTHN_RP_ID: 'ottawabybike.ca',
        WEBAUTHN_RP_NAME: 'Ottawa by Bike',
        WEBAUTHN_ORIGIN: 'https://ottawabybike.ca',
      });
      expect(config.rpID).toBe('ottawabybike.ca');
      expect(config.rpName).toBe('Ottawa by Bike');
      expect(config.origin).toBe('https://ottawabybike.ca');
    });
  });
});

import fs from 'node:fs';
import path from 'node:path';

describe('session lifecycle', () => {
  const dbPath = path.join(import.meta.dirname, '.test-auth.db');
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
      id: 'user-1', email: 'test@test.com', username: 'testuser', role: 'editor',
      createdAt: new Date().toISOString(),
    });
  });

  afterAll(() => {
    for (const ext of ['', '-wal', '-shm']) {
      const f = dbPath + ext;
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }
  });

  it('createSession + validateSession returns correct user', async () => {
    const { createSession, validateSession } = await import('../src/lib/auth/auth');

    const token = await createSession(database, 'user-1');
    expect(token).toMatch(/^[0-9a-f]{64}$/);

    const user = await validateSession(database, token);
    expect(user).not.toBeNull();
    expect(user!.id).toBe('user-1');
    expect(user!.username).toBe('testuser');
    expect(user!.role).toBe('editor');
  });

  it('validateSession returns null for expired session', async () => {
    const { validateSession } = await import('../src/lib/auth/auth');
    const { sessions } = await import('../src/db/schema');

    await database.insert(sessions).values({
      id: 'sess-expired',
      userId: 'user-1',
      token: 'expired-token-abc',
      expiresAt: '2020-01-01T00:00:00.000Z',
      createdAt: new Date().toISOString(),
    });

    const user = await validateSession(database, 'expired-token-abc');
    expect(user).toBeNull();
  });

  it('validateSession returns null for invalid token', async () => {
    const { validateSession } = await import('../src/lib/auth/auth');
    const user = await validateSession(database, 'nonexistent-token');
    expect(user).toBeNull();
  });

  it('createSession cleans up expired sessions', async () => {
    const { createSession } = await import('../src/lib/auth/auth');
    const { sessions } = await import('../src/db/schema');

    await database.insert(sessions).values({
      id: 'sess-old',
      userId: 'user-1',
      token: 'old-token',
      expiresAt: '2020-01-01T00:00:00.000Z',
      createdAt: '2020-01-01T00:00:00.000Z',
    });

    await createSession(database, 'user-1');

    const allSessions = await database.select().from(sessions);
    expect(allSessions.every((s: any) => s.token !== 'old-token')).toBe(true);
  });

  it('validateSession returns user settings', async () => {
    const { createSession, validateSession } = await import('../src/lib/auth/auth');
    const { userSettings } = await import('../src/db/schema');

    await database.insert(userSettings).values({
      userId: 'user-1',
      emailInCommits: true,
      analyticsOptOut: false,
    });

    const token = await createSession(database, 'user-1');
    const user = await validateSession(database, token);
    expect(user).not.toBeNull();
    expect(user!.emailInCommits).toBe(true);
    expect(user!.analyticsOptOut).toBe(false);
  });

  it('validateSession returns defaults when no settings row', async () => {
    const { createSession, validateSession } = await import('../src/lib/auth/auth');

    const token = await createSession(database, 'user-1');
    const user = await validateSession(database, token);
    expect(user).not.toBeNull();
    expect(user!.emailInCommits).toBe(false);
    expect(user!.analyticsOptOut).toBe(false);
  });
});

describe('findUserByIdentifier', () => {
  const dbPath = path.join(import.meta.dirname, '.test-auth-identifier.db');
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
  });

  afterAll(() => {
    for (const ext of ['', '-wal', '-shm']) {
      const f = dbPath + ext;
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }
  });

  it('finds user by email when identifier contains @', async () => {
    const user = await findUserByIdentifier(database, 'alice@example.com');
    expect(user).not.toBeNull();
    expect(user!.id).toBe('user-1');
    expect(user!.username).toBe('alice');
  });

  it('normalizes email (case-insensitive)', async () => {
    const user = await findUserByIdentifier(database, 'Alice@Example.COM');
    expect(user).not.toBeNull();
    expect(user!.id).toBe('user-1');
  });

  it('finds user by username when no @', async () => {
    const user = await findUserByIdentifier(database, 'alice');
    expect(user).not.toBeNull();
    expect(user!.id).toBe('user-1');
  });

  it('sanitizes username input', async () => {
    const user = await findUserByIdentifier(database, 'Alice');
    expect(user).not.toBeNull();
    expect(user!.id).toBe('user-1');
  });

  it('returns null for unknown email', async () => {
    const user = await findUserByIdentifier(database, 'nobody@example.com');
    expect(user).toBeNull();
  });

  it('returns null for unknown username', async () => {
    const user = await findUserByIdentifier(database, 'nobody');
    expect(user).toBeNull();
  });
});

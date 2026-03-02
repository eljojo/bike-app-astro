import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('local SQLite database', () => {
  const dbPath = path.join(import.meta.dirname, '.test-local.db');

  afterAll(() => {
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    // WAL mode creates journal files alongside the database
    const walPath = dbPath + '-wal';
    const shmPath = dbPath + '-shm';
    if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
    if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);
  });

  it('creates a working database with all tables', async () => {
    const { createLocalDb } = await import('../src/db/local');
    const db = createLocalDb(dbPath);

    const { users, sessions, credentials, inviteCodes, routeEdits } = await import('../src/db/schema');

    const userRows = await db.select().from(users).all();
    expect(Array.isArray(userRows)).toBe(true);

    const sessionRows = await db.select().from(sessions).all();
    expect(Array.isArray(sessionRows)).toBe(true);

    const credRows = await db.select().from(credentials).all();
    expect(Array.isArray(credRows)).toBe(true);

    const inviteRows = await db.select().from(inviteCodes).all();
    expect(Array.isArray(inviteRows)).toBe(true);

    const editRows = await db.select().from(routeEdits).all();
    expect(Array.isArray(editRows)).toBe(true);
  });

  it('supports insert and query operations', async () => {
    const { createLocalDb } = await import('../src/db/local');
    const db = createLocalDb(dbPath);
    const { users } = await import('../src/db/schema');
    const { eq } = await import('drizzle-orm');

    await db.insert(users).values({
      id: 'test-1',
      email: 'test@example.com',
      displayName: 'Test User',
      role: 'admin',
      createdAt: new Date().toISOString(),
    });

    const result = await db.select().from(users).where(eq(users.id, 'test-1')).get();
    expect(result).toBeDefined();
    expect(result!.email).toBe('test@example.com');
    expect(result!.displayName).toBe('Test User');
  });
});

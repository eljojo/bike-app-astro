import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('rate-limit', () => {
  const dbPath = path.join(import.meta.dirname, '.test-rate-limit.db');
  let database: any;

  beforeEach(async () => {
    for (const ext of ['', '-wal', '-shm']) {
      const f = dbPath + ext;
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }
    const { createLocalDb } = await import('../src/db/local');
    database = createLocalDb(dbPath);
  });

  afterAll(() => {
    for (const ext of ['', '-wal', '-shm']) {
      const f = dbPath + ext;
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }
  });

  it('checkRateLimit returns false when under limit', async () => {
    const { checkRateLimit, recordAttempt } = await import('../src/lib/auth/rate-limit');

    await recordAttempt(database, 'presign', ['user:u1']);
    expect(await checkRateLimit(database, 'presign', ['user:u1'], 10)).toBe(false);
  });

  it('checkRateLimit returns true when at limit', async () => {
    const { checkRateLimit, recordAttempt } = await import('../src/lib/auth/rate-limit');

    for (let i = 0; i < 10; i++) {
      await recordAttempt(database, 'presign', ['user:u1']);
    }

    expect(await checkRateLimit(database, 'presign', ['user:u1'], 10)).toBe(true);
  });

  it('blocks if any identifier is over limit', async () => {
    const { checkRateLimit, recordAttempt } = await import('../src/lib/auth/rate-limit');

    // user:u1 has 3 attempts, ip:1.2.3.4 has 5 (over limit of 5)
    for (let i = 0; i < 3; i++) {
      await recordAttempt(database, 'presign', ['user:u1']);
    }
    for (let i = 0; i < 5; i++) {
      await recordAttempt(database, 'presign', ['ip:1.2.3.4']);
    }

    expect(await checkRateLimit(database, 'presign', ['user:u1', 'ip:1.2.3.4'], 5)).toBe(true);
  });

  it('does not count attempts for different actions', async () => {
    const { checkRateLimit, recordAttempt } = await import('../src/lib/auth/rate-limit');

    for (let i = 0; i < 10; i++) {
      await recordAttempt(database, 'other-action', ['user:u1']);
    }

    expect(await checkRateLimit(database, 'presign', ['user:u1'], 10)).toBe(false);
  });

  it('does not count attempts for different identifiers', async () => {
    const { checkRateLimit, recordAttempt } = await import('../src/lib/auth/rate-limit');

    for (let i = 0; i < 10; i++) {
      await recordAttempt(database, 'presign', ['user:other']);
    }

    expect(await checkRateLimit(database, 'presign', ['user:u1'], 10)).toBe(false);
  });

  it('does not count expired attempts', async () => {
    const { checkRateLimit } = await import('../src/lib/auth/rate-limit');
    const { uploadAttempts } = await import('../src/db/schema');

    // Insert rows with a timestamp 2 hours ago
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    for (let i = 0; i < 10; i++) {
      await database.insert(uploadAttempts).values({
        action: 'presign',
        identifier: 'user:u1',
        createdAt: twoHoursAgo,
      });
    }

    expect(await checkRateLimit(database, 'presign', ['user:u1'], 10)).toBe(false);
  });

  it('cleanupOldAttempts removes expired rows', async () => {
    const { cleanupOldAttempts } = await import('../src/lib/auth/rate-limit');
    const { uploadAttempts } = await import('../src/db/schema');

    // Insert old and new rows
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const now = new Date().toISOString();

    await database.insert(uploadAttempts).values([
      { action: 'presign', identifier: 'user:u1', createdAt: twoHoursAgo },
      { action: 'presign', identifier: 'user:u1', createdAt: now },
    ]);

    await cleanupOldAttempts(database, 'presign');

    const rows = await database.select().from(uploadAttempts);
    expect(rows).toHaveLength(1);
    expect(rows[0].createdAt).toBe(now);
  });

  it('LIMITS has correct values', async () => {
    const { LIMITS } = await import('../src/lib/auth/rate-limit');
    expect(LIMITS.guest).toBe(10);
    expect(LIMITS.editor).toBe(50);
    expect(LIMITS.admin).toBeUndefined();
  });
});

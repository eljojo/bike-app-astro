import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { CITY } from '../src/lib/config/config';
import { upsertContentCache } from '../src/lib/content/cache';
import { contentEdits } from '../src/db/schema';
import { eq, and } from 'drizzle-orm';
const dbPath = path.join(import.meta.dirname, '.test-cache.db');

function cleanupDb() {
  for (const ext of ['', '-wal', '-shm']) {
    const f = dbPath + ext;
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
}

describe('upsertContentCache', () => {
  let database: any;

  beforeEach(async () => {
    cleanupDb();
    const { createLocalDb } = await import('../src/db/local');
    database = createLocalDb(dbPath);
  });

  afterAll(() => {
    cleanupDb();
  });

  it('inserts a new cache entry', async () => {
    await upsertContentCache(database, {
      contentType: 'routes',
      contentSlug: 'test-route',
      data: '{"slug":"test-route"}',
      githubSha: 'abc123',
    });

    const rows = database
      .select()
      .from(contentEdits)
      .where(and(
        eq(contentEdits.city, CITY),
        eq(contentEdits.contentType, 'routes'),
        eq(contentEdits.contentSlug, 'test-route'),
      ))
      .all();

    expect(rows).toHaveLength(1);
    expect(rows[0].data).toBe('{"slug":"test-route"}');
    expect(rows[0].githubSha).toBe('abc123');
  });

  it('updates existing entry on conflict', async () => {
    await upsertContentCache(database, {
      contentType: 'routes',
      contentSlug: 'test-route',
      data: '{"version":1}',
      githubSha: 'sha-v1',
    });

    await upsertContentCache(database, {
      contentType: 'routes',
      contentSlug: 'test-route',
      data: '{"version":2}',
      githubSha: 'sha-v2',
    });

    const rows = database
      .select()
      .from(contentEdits)
      .where(and(
        eq(contentEdits.city, CITY),
        eq(contentEdits.contentType, 'routes'),
        eq(contentEdits.contentSlug, 'test-route'),
      ))
      .all();

    expect(rows).toHaveLength(1);
    expect(rows[0].data).toBe('{"version":2}');
    expect(rows[0].githubSha).toBe('sha-v2');
  });
});

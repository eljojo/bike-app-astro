import { createLocalDb } from '../src/db/local';
import fs from 'node:fs';

/**
 * Create a fresh SQLite database with the full schema applied.
 *
 * Each call creates a unique file to prevent cross-test pollution.
 * Call `cleanup()` in afterAll to remove the file.
 *
 * Usage:
 *   let testDb: ReturnType<typeof createTestDb>;
 *   beforeEach(() => { testDb = createTestDb(); });
 *   afterAll(() => { testDb.cleanup(); });
 */
export function createTestDb() {
  const dbPath = `.test-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.db`;
  const database = createLocalDb(dbPath);

  return {
    db: database,
    path: dbPath,
    cleanup() {
      for (const ext of ['', '-wal', '-shm']) {
        try { fs.unlinkSync(dbPath + ext); } catch {}
      }
    },
  };
}

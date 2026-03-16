import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { extractFrontmatterField, parkOrphanedPhoto, updatePhotoRegistryCache } from '../../src/lib/media/photo-parking.server';
import type { PhotoKeyChange } from '../../src/lib/content/save-helpers';
import { CITY } from '../../src/lib/config/config';

// Mock dependencies
// eslint-disable-next-line bike-app/no-hardcoded-city-locale -- mock definition
vi.mock('../../src/lib/config/config', () => ({ CITY: 'ottawa' }));

// Shared mock DB variable — defaults to fake chain for parkOrphanedPhoto tests,
// swapped to real SQLite for updatePhotoRegistryCache tests.
const mockDbGet = vi.fn(() => null);
let mockDbInstance: any = {
  select: () => ({ from: () => ({ where: () => ({ get: () => mockDbGet() }) }) }),
  insert: () => ({ values: () => ({ onConflictDoUpdate: vi.fn() }) }),
};
vi.mock('../../src/lib/get-db', () => ({
  db: () => mockDbInstance,
}));

describe('extractFrontmatterField', () => {
  it('extracts a field from YAML frontmatter', () => {
    const content = '---\nname: Test\nphoto_key: abc123\n---\nBody text';
    expect(extractFrontmatterField(content, 'photo_key')).toBe('abc123');
  });

  it('returns undefined for missing field', () => {
    const content = '---\nname: Test\n---\nBody text';
    expect(extractFrontmatterField(content, 'photo_key')).toBeUndefined();
  });

  it('returns undefined for content without frontmatter', () => {
    expect(extractFrontmatterField('No frontmatter here', 'photo_key')).toBeUndefined();
  });
});

describe('parkOrphanedPhoto', () => {
  const mockGit = {
    readFile: vi.fn(),
    writeFiles: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockDbGet.mockReturnValue(null);
  });

  it('returns null when oldKey is undefined', async () => {
    const result = await parkOrphanedPhoto({
      oldKey: undefined,
      newKey: 'new-key',
      contentType: 'place',
      contentId: 'test-place',
      sharedKeysData: {},
      git: mockGit as any,
    });
    expect(result).toBeNull();
  });

  it('returns null when keys are the same', async () => {
    const result = await parkOrphanedPhoto({
      oldKey: 'same-key',
      newKey: 'same-key',
      contentType: 'place',
      contentId: 'test-place',
      sharedKeysData: {},
      git: mockGit as any,
    });
    expect(result).toBeNull();
  });

  it('parks a photo when not used elsewhere', async () => {
    mockGit.readFile.mockResolvedValue(null); // no existing parked-photos.yml

    const result = await parkOrphanedPhoto({
      oldKey: 'orphan-key',
      newKey: undefined,
      contentType: 'place',
      contentId: 'test-place',
      sharedKeysData: {},
      git: mockGit as any,
    });

    expect(result).not.toBeNull();
    expect(result!.mergedParked).toEqual([{ key: 'orphan-key' }]);
    expect(result!.fileChange.path).toBe(`${CITY}/parked-photos.yml`);
  });

  it('returns null when photo is used by another content item', async () => {
    const result = await parkOrphanedPhoto({
      oldKey: 'shared-key',
      newKey: undefined,
      contentType: 'place',
      contentId: 'place-a',
      sharedKeysData: {
        'shared-key': [
          { type: 'place', slug: 'place-a' },
          { type: 'route', slug: 'some-route' },
        ],
      },
      git: mockGit as any,
    });

    expect(result).toBeNull();
  });
});

describe('updatePhotoRegistryCache', () => {
  const dbPath = path.join(import.meta.dirname, '.test-photo-parking.db');
  let database: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    for (const ext of ['', '-wal', '-shm']) {
      const f = dbPath + ext;
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }
    const { createLocalDb } = await import('../../src/db/local');
    database = createLocalDb(dbPath);
    // Point the get-db mock at the real database so loadSharedKeysMap resolves
    mockDbInstance = database;
  });

  afterAll(() => {
    for (const ext of ['', '-wal', '-shm']) {
      const f = dbPath + ext;
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }
    // Restore the fake chain for any subsequent test modules
    mockDbInstance = {
      select: () => ({ from: () => ({ where: () => ({ get: () => mockDbGet() }) }) }),
      insert: () => ({ values: () => ({ onConflictDoUpdate: vi.fn() }) }),
    };
  });

  it('writes shared-keys to cache when keys change', async () => {
    const changes: PhotoKeyChange[] = [
      { key: 'new-key', usage: { type: 'place', slug: 'test' }, action: 'add' },
    ];

    await updatePhotoRegistryCache({
      database,
      sharedKeysData: {},
      keyChanges: changes,
    });

    const { contentEdits } = await import('../../src/db/schema');
    const { eq, and } = await import('drizzle-orm');
    const row = await database.select().from(contentEdits)
      .where(and(
        eq(contentEdits.contentType, 'photo-shared-keys'),
        eq(contentEdits.contentSlug, '__global'),
      )).get();

    expect(row).toBeTruthy();
    const parsed = JSON.parse(row.data);
    expect(parsed['new-key']).toBeDefined();
  });

  it('writes parked-photos when mergedParked provided', async () => {
    await updatePhotoRegistryCache({
      database,
      sharedKeysData: {},
      keyChanges: [],
      mergedParked: [{ key: 'parked-1' }],
    });

    const { contentEdits } = await import('../../src/db/schema');
    const { eq, and } = await import('drizzle-orm');
    const row = await database.select().from(contentEdits)
      .where(and(
        eq(contentEdits.contentType, 'parked-photos'),
        eq(contentEdits.contentSlug, '__global'),
      )).get();

    expect(row).toBeTruthy();
    const parsed = JSON.parse(row.data);
    expect(parsed).toEqual([{ key: 'parked-1' }]);
  });

  it('skips writes when no changes and no parked', async () => {
    await updatePhotoRegistryCache({
      database,
      sharedKeysData: {},
      keyChanges: [],
    });

    const { contentEdits } = await import('../../src/db/schema');
    const rows = await database.select().from(contentEdits);
    expect(rows).toHaveLength(0);
  });
});

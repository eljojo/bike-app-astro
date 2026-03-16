import { describe, it, expect, vi, beforeEach } from 'vitest';
import { extractFrontmatterField, parkOrphanedPhoto, updatePhotoRegistryCache } from '../../src/lib/media/photo-parking';
import type { PhotoKeyChange } from '../../src/lib/content/save-helpers';

// Mock dependencies
vi.mock('../../src/lib/config/config', () => ({ CITY: 'ottawa' }));

const mockDbGet = vi.fn(() => null);
const mockOnConflictDoUpdate = vi.fn();
vi.mock('../../src/lib/get-db', () => ({
  db: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          get: () => mockDbGet(),
        }),
      }),
    }),
    insert: () => ({
      values: () => ({
        onConflictDoUpdate: mockOnConflictDoUpdate,
      }),
    }),
  }),
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
    expect(result!.fileChange.path).toBe('ottawa/parked-photos.yml');
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
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbGet.mockReturnValue(null);
  });

  it('updates shared-keys cache for key changes', async () => {
    const changes: PhotoKeyChange[] = [
      { key: 'new-key', usage: { type: 'place', slug: 'test' }, action: 'add' },
    ];

    const database = {
      select: () => ({ from: () => ({ where: () => ({ get: () => mockDbGet() }) }) }),
      insert: () => ({ values: () => ({ onConflictDoUpdate: mockOnConflictDoUpdate }) }),
    };

    await updatePhotoRegistryCache({
      database: database as any,
      sharedKeysData: {},
      keyChanges: changes,
    });

    expect(mockOnConflictDoUpdate).toHaveBeenCalled();
  });

  it('updates parked-photos cache when mergedParked provided', async () => {
    const database = {
      select: () => ({ from: () => ({ where: () => ({ get: () => mockDbGet() }) }) }),
      insert: () => ({ values: () => ({ onConflictDoUpdate: mockOnConflictDoUpdate }) }),
    };

    await updatePhotoRegistryCache({
      database: database as any,
      sharedKeysData: {},
      keyChanges: [],
      mergedParked: [{ key: 'parked-1' }],
    });

    expect(mockOnConflictDoUpdate).toHaveBeenCalled();
  });

  it('skips shared-keys update when no changes', async () => {
    const database = {
      select: () => ({ from: () => ({ where: () => ({ get: () => mockDbGet() }) }) }),
      insert: () => ({ values: () => ({ onConflictDoUpdate: mockOnConflictDoUpdate }) }),
    };

    await updatePhotoRegistryCache({
      database: database as any,
      sharedKeysData: {},
      keyChanges: [],
    });

    expect(mockOnConflictDoUpdate).not.toHaveBeenCalled();
  });
});

import { describe, it, expect } from 'vitest';
import { buildPhotoKeyChanges, computeMediaKeyDiff, buildMediaKeyChanges, buildCommitTrailer, mergeFrontmatter, loadExistingMedia } from '../../src/lib/save-helpers';

describe('buildPhotoKeyChanges', () => {
  it('returns empty array when keys are the same', () => {
    expect(buildPhotoKeyChanges('abc', 'abc', 'event', 'my-event')).toEqual([]);
  });

  it('returns add when new key replaces undefined', () => {
    const changes = buildPhotoKeyChanges(undefined, 'new-key', 'event', 'my-event');
    expect(changes).toEqual([
      { key: 'new-key', usage: { type: 'event', slug: 'my-event' }, action: 'add' },
    ]);
  });

  it('returns remove when old key replaced by undefined', () => {
    const changes = buildPhotoKeyChanges('old-key', undefined, 'place', 'my-place');
    expect(changes).toEqual([
      { key: 'old-key', usage: { type: 'place', slug: 'my-place' }, action: 'remove' },
    ]);
  });

  it('returns both remove and add when keys differ', () => {
    const changes = buildPhotoKeyChanges('old', 'new', 'event', 'evt');
    expect(changes).toHaveLength(2);
    expect(changes[0]).toEqual({ key: 'old', usage: { type: 'event', slug: 'evt' }, action: 'remove' });
    expect(changes[1]).toEqual({ key: 'new', usage: { type: 'event', slug: 'evt' }, action: 'add' });
  });
});

describe('computeMediaKeyDiff', () => {
  it('returns empty arrays when both inputs are empty', () => {
    expect(computeMediaKeyDiff([], [])).toEqual({ addedKeys: [], removedKeys: [] });
  });

  it('returns all new keys as added when existing is empty', () => {
    const result = computeMediaKeyDiff([], [{ key: 'a' }, { key: 'b' }]);
    expect(result.addedKeys).toEqual(['a', 'b']);
    expect(result.removedKeys).toEqual([]);
  });

  it('returns all old keys as removed when new is empty', () => {
    const result = computeMediaKeyDiff([{ key: 'x' }, { key: 'y' }], []);
    expect(result.addedKeys).toEqual([]);
    expect(result.removedKeys).toEqual(['x', 'y']);
  });

  it('detects added and removed keys in overlapping sets', () => {
    const existing = [{ key: 'keep' }, { key: 'remove-me' }];
    const updated = [{ key: 'keep' }, { key: 'new-one' }];
    const result = computeMediaKeyDiff(existing, updated);
    expect(result.addedKeys).toEqual(['new-one']);
    expect(result.removedKeys).toEqual(['remove-me']);
  });

  it('returns empty arrays when sets are identical', () => {
    const items = [{ key: 'a' }, { key: 'b' }];
    const result = computeMediaKeyDiff(items, items);
    expect(result).toEqual({ addedKeys: [], removedKeys: [] });
  });
});

describe('buildMediaKeyChanges', () => {
  it('returns empty array when no keys added or removed', () => {
    expect(buildMediaKeyChanges([], [], 'route', 'my-route')).toEqual([]);
  });

  it('returns remove entries for each removed key', () => {
    const changes = buildMediaKeyChanges([], ['old-1', 'old-2'], 'route', 'my-route');
    expect(changes).toHaveLength(2);
    expect(changes[0]).toEqual({ key: 'old-1', usage: { type: 'route', slug: 'my-route' }, action: 'remove' });
    expect(changes[1]).toEqual({ key: 'old-2', usage: { type: 'route', slug: 'my-route' }, action: 'remove' });
  });

  it('returns add entries for each added key', () => {
    const changes = buildMediaKeyChanges(['new-1'], [], 'event', 'e1');
    expect(changes).toHaveLength(1);
    expect(changes[0]).toEqual({ key: 'new-1', usage: { type: 'event', slug: 'e1' }, action: 'add' });
  });

  it('returns removes before adds', () => {
    const changes = buildMediaKeyChanges(['added'], ['removed'], 'route', 'r1');
    expect(changes[0].action).toBe('remove');
    expect(changes[1].action).toBe('add');
  });
});

describe('buildCommitTrailer', () => {
  it('formats the Changes trailer line', () => {
    expect(buildCommitTrailer('ottawa/routes/britannia')).toBe('\n\nChanges: ottawa/routes/britannia');
  });
});

describe('mergeFrontmatter', () => {
  it('adds default status and timestamps for new content', () => {
    const result = mergeFrontmatter(true, null, { name: 'My Route' });
    expect(result.name).toBe('My Route');
    expect(result.status).toBe('published');
    expect(result.created_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('does not overwrite explicit status for new content', () => {
    const result = mergeFrontmatter(true, null, { name: 'Draft', status: 'draft' });
    expect(result.status).toBe('draft');
  });

  it('overlays updates onto existing frontmatter', () => {
    const existing = '---\nname: Old Name\ntags:\n  - cycling\nstatus: published\n---\nBody text';
    const result = mergeFrontmatter(false, existing, { name: 'New Name' });
    expect(result.name).toBe('New Name');
    expect(result.tags).toEqual(['cycling']);
    expect(result.status).toBe('published');
  });

  it('returns updates as-is when existing content is null but not new', () => {
    const result = mergeFrontmatter(false, null, { name: 'Orphan' });
    expect(result.name).toBe('Orphan');
    expect(result.status).toBeUndefined();
  });
});

describe('loadExistingMedia', () => {
  it('returns empty array when no auxiliary files exist', () => {
    expect(loadExistingMedia({})).toEqual([]);
  });

  it('returns empty array when no media.yml found', () => {
    expect(loadExistingMedia({ 'index.md': { content: '---\n---', sha: 'abc' } })).toEqual([]);
  });

  it('parses media.yml content', () => {
    const files = {
      'routes/test/media.yml': {
        content: '- key: photo1\n  caption: A photo\n- key: photo2\n',
        sha: 'abc',
      },
    };
    const result = loadExistingMedia(files);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ key: 'photo1', caption: 'A photo' });
    expect(result[1]).toEqual({ key: 'photo2' });
  });

  it('matches both media.yml and -media.yml suffixes', () => {
    const files = {
      'rides/2026-01-01-test-media.yml': {
        content: '- key: ride-photo\n',
        sha: 'abc',
      },
    };
    const result = loadExistingMedia(files);
    expect(result).toHaveLength(1);
    expect(result[0].key).toBe('ride-photo');
  });

  it('returns empty array for null file entries', () => {
    const files: Record<string, { content: string; sha: string } | null> = {
      'routes/test/media.yml': null,
    };
    expect(loadExistingMedia(files)).toEqual([]);
  });
});

import { describe, it, expect } from 'vitest';
import { buildPhotoKeyChanges } from '../../src/lib/save-helpers';

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

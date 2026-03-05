import { describe, it, expect } from 'vitest';
import { mergeMedia } from '../src/lib/media-merge';

describe('mergeMedia', () => {
  it('preserves existing photo metadata when admin changes caption', () => {
    const existing = [
      { type: 'photo', key: 'abc', caption: 'old', score: 5.5, width: 1600, height: 1200, handle: 'old-handle' },
    ];
    const adminPhotos = [
      { key: 'abc', caption: 'new caption' },
    ];
    const result = mergeMedia(adminPhotos, existing);
    expect(result).toEqual([
      { type: 'photo', key: 'abc', caption: 'new caption', score: 5.5, width: 1600, height: 1200, handle: 'old-handle' },
    ]);
  });

  it('preserves video entries at the end', () => {
    const existing = [
      { type: 'photo', key: 'p1', caption: 'photo' },
      { type: 'video', key: 'v1', title: 'My Video', duration: '5:30' },
    ];
    const adminPhotos = [
      { key: 'p1', caption: 'photo' },
    ];
    const result = mergeMedia(adminPhotos, existing);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ type: 'photo', key: 'p1' });
    expect(result[1]).toMatchObject({ type: 'video', key: 'v1', title: 'My Video', duration: '5:30' });
  });

  it('creates new entries with type photo and score 1', () => {
    const existing: any[] = [];
    const adminPhotos = [
      { key: 'new1', caption: 'fresh upload', width: 800, height: 600 },
    ];
    const result = mergeMedia(adminPhotos, existing);
    expect(result).toEqual([
      { type: 'photo', key: 'new1', caption: 'fresh upload', score: 1, width: 800, height: 600 },
    ]);
  });

  it('respects admin photo order', () => {
    const existing = [
      { type: 'photo', key: 'a', score: 3 },
      { type: 'photo', key: 'b', score: 7 },
      { type: 'photo', key: 'c', score: 5 },
    ];
    const adminPhotos = [
      { key: 'c' },
      { key: 'a' },
      { key: 'b' },
    ];
    const result = mergeMedia(adminPhotos, existing);
    expect(result[0].key).toBe('c');
    expect(result[1].key).toBe('a');
    expect(result[2].key).toBe('b');
  });

  it('removes photos not in admin array', () => {
    const existing = [
      { type: 'photo', key: 'keep' },
      { type: 'photo', key: 'remove' },
    ];
    const adminPhotos = [
      { key: 'keep' },
    ];
    const result = mergeMedia(adminPhotos, existing);
    expect(result).toHaveLength(1);
    expect(result[0].key).toBe('keep');
  });

  it('sets cover from admin', () => {
    const existing = [
      { type: 'photo', key: 'a', cover: true },
      { type: 'photo', key: 'b' },
    ];
    const adminPhotos = [
      { key: 'a' },
      { key: 'b', cover: true },
    ];
    const result = mergeMedia(adminPhotos, existing);
    expect(result[0].cover).toBeUndefined();
    expect(result[1].cover).toBe(true);
  });

  it('empty photos array preserves video entries', () => {
    const existing = [
      { type: 'video', key: 'v1', title: 'My Video' },
    ];
    const result = mergeMedia([], existing);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ type: 'video', key: 'v1' });
  });

  it('empty photos + empty existing returns empty array', () => {
    const result = mergeMedia([], []);
    expect(result).toEqual([]);
  });
});

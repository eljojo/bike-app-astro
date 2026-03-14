import { describe, it, expect } from 'vitest';
import { mergeMedia } from '../src/lib/media/media-merge';

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

  it('includes video entries when present in admin array', () => {
    const existing = [
      { type: 'photo', key: 'p1', caption: 'photo' },
      { type: 'video', key: 'v1', title: 'My Video', duration: '5:30' },
    ];
    const adminMedia = [
      { key: 'p1', caption: 'photo' },
      { key: 'v1', type: 'video' as const, title: 'My Video' },
    ];
    const result = mergeMedia(adminMedia, existing);
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

  it('empty admin array drops all media', () => {
    const existing = [
      { type: 'video', key: 'v1', title: 'My Video' },
    ];
    const result = mergeMedia([], existing);
    expect(result).toHaveLength(0);
  });

  it('empty photos + empty existing returns empty array', () => {
    const result = mergeMedia([], []);
    expect(result).toEqual([]);
  });

  it('preserves video fields and respects ordering across media types', () => {
    const adminMedia = [
      { key: 'video1', type: 'video' as const, title: 'Updated Title' },
      { key: 'photo1', cover: true },
    ];
    const existing = [
      { type: 'photo', key: 'photo1', score: 10, width: 1600, height: 1200, handle: 'cover' },
      { type: 'video', key: 'video1', title: 'Old Title', duration: 'PT31S', handle: 'my-ride', poster_key: 'abc', width: 1920, height: 1080 },
    ];
    const merged = mergeMedia(adminMedia, existing);
    // Video moved to first position
    expect(merged[0].key).toBe('video1');
    expect(merged[0].type).toBe('video');
    expect(merged[0].title).toBe('Updated Title');
    // Existing video fields preserved
    expect(merged[0].duration).toBe('PT31S');
    expect(merged[0].poster_key).toBe('abc');
    // Photo second
    expect(merged[1].key).toBe('photo1');
    expect(merged[1].cover).toBe(true);
  });

  it('removes videos not in admin array', () => {
    const adminMedia = [
      { key: 'photo1' },
    ];
    const existing = [
      { type: 'photo', key: 'photo1' },
      { type: 'video', key: 'video1', title: 'Old Video' },
    ];
    const merged = mergeMedia(adminMedia, existing);
    expect(merged).toHaveLength(1);
    expect(merged[0].key).toBe('photo1');
  });

  it('creates new video entries from admin', () => {
    const adminMedia = [
      { key: 'vid1', type: 'video' as const, title: 'New Video', handle: 'new-video' },
    ];
    const merged = mergeMedia(adminMedia, []);
    expect(merged).toHaveLength(1);
    expect(merged[0].type).toBe('video');
    expect(merged[0].title).toBe('New Video');
    expect(merged[0].handle).toBe('new-video');
  });

  it('preserves transcoding video metadata through save', () => {
    const adminMedia = [
      { key: 'photo1', cover: true },
      { key: 'video1', type: 'video' as const, title: 'My Ride', handle: 'my-ride' },
    ];
    const existing = [
      { type: 'photo', key: 'photo1', width: 1600, height: 1200, handle: 'cover' },
    ];
    const merged = mergeMedia(adminMedia, existing);
    expect(merged).toHaveLength(2);
    expect(merged[1].type).toBe('video');
    expect(merged[1].title).toBe('My Ride');
    expect(merged[1].handle).toBe('my-ride');
  });
});

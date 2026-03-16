import { describe, it, expect } from 'vitest';
import { mergeMedia } from '../../src/lib/media/media-merge';

describe('mergeMedia with coordinates', () => {
  it('preserves lat/lng on existing photos', () => {
    const existing = [
      { type: 'photo', key: 'abc', lat: 45.42, lng: -75.69, score: 3 },
    ];
    const admin = [{ key: 'abc', caption: 'updated' }];
    const result = mergeMedia(admin, existing);
    expect(result[0]).toMatchObject({ lat: 45.42, lng: -75.69, caption: 'updated' });
  });

  it('includes lat/lng/uploaded_by on new photos', () => {
    const admin = [{ key: 'new1', lat: 45.5, lng: -75.7, uploaded_by: 'testuser' }];
    const result = mergeMedia(admin, []);
    expect(result[0]).toMatchObject({
      type: 'photo',
      key: 'new1',
      lat: 45.5,
      lng: -75.7,
      uploaded_by: 'testuser',
    });
  });
});

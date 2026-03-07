import { describe, it, expect } from 'vitest';
import { computePlaceContentHash, placeDetailFromGit, buildFreshPlaceData } from '../../src/lib/models/place-model';

describe('place-model', () => {
  it('computes consistent content hash', () => {
    const content = '---\nname: Test Place\ncategory: cafe\nlat: 45.0\nlng: -75.0\n---\n';
    const hash1 = computePlaceContentHash(content);
    const hash2 = computePlaceContentHash(content);
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(32);
  });

  it('parses place detail from frontmatter', () => {
    const detail = placeDetailFromGit('test-cafe', {
      name: 'Test Cafe',
      category: 'cafe',
      lat: 45.123,
      lng: -75.456,
      address: '123 Main St',
    });
    expect(detail.id).toBe('test-cafe');
    expect(detail.name).toBe('Test Cafe');
    expect(detail.category).toBe('cafe');
    expect(detail.lat).toBe(45.123);
    expect(detail.address).toBe('123 Main St');
  });

  it('builds fresh cache data from files', () => {
    const files = {
      primaryFile: {
        content: '---\nname: "Test"\ncategory: park\nlat: 45.0\nlng: -75.0\n---\n',
        sha: 'abc123',
      },
    };
    const data = buildFreshPlaceData('test-park', files);
    const parsed = JSON.parse(data);
    expect(parsed.name).toBe('Test');
    expect(parsed.category).toBe('park');
  });
});

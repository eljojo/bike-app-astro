import { describe, it, expect } from 'vitest';
import type { FeatureCollection } from 'geojson';
import { buildTiles, buildSlugIndex, type GeoMetaEntry } from '../scripts/generate-path-tiles';

describe('slug index generation', () => {
  function makeFC(coords: [number, number][]): FeatureCollection {
    return {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: coords },
      }],
    };
  }

  function makeMeta(slug: string): GeoMetaEntry {
    return { slug, name: slug, memberOf: '', surface: 'asphalt', hasPage: true, path_type: 'mup', length_km: 1 };
  }

  it('buildSlugIndex maps slugs to tile IDs and geometry hashes', () => {
    const input = new Map<string, FeatureCollection>();
    input.set('100', makeFC([[0, 0], [1, 1]]));
    input.set('200', makeFC([[2, 2], [3, 3]]));

    const metadata = new Map<string, GeoMetaEntry>();
    metadata.set('100', makeMeta('path-a'));
    metadata.set('200', makeMeta('path-b'));

    const { tiles } = buildTiles(input, metadata);
    const index = buildSlugIndex(tiles);

    expect(index['path-a']).toBeDefined();
    expect(index['path-a'].tiles).toHaveLength(1);
    expect(index['path-a'].hash).toMatch(/^[a-f0-9]{12}$/);

    expect(index['path-b']).toBeDefined();
    expect(index['path-b'].hash).toMatch(/^[a-f0-9]{12}$/);
    expect(index['path-a'].hash).not.toBe(index['path-b'].hash);
  });

  it('produces deterministic hashes', () => {
    const input = new Map<string, FeatureCollection>();
    input.set('100', makeFC([[0, 0], [1, 1]]));

    const metadata = new Map<string, GeoMetaEntry>();
    metadata.set('100', makeMeta('path-a'));

    const { tiles: tiles1 } = buildTiles(input, metadata);
    const { tiles: tiles2 } = buildTiles(input, metadata);
    const index1 = buildSlugIndex(tiles1);
    const index2 = buildSlugIndex(tiles2);

    expect(index1['path-a'].hash).toBe(index2['path-a'].hash);
  });
});

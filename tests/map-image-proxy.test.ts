import { describe, it, expect } from 'vitest';
import { MAP_SIZE_PRESETS, buildGoogleMapsUrl } from '../src/views/api/map-image-helpers';

describe('MAP_SIZE_PRESETS', () => {
  it('has a social preset', () => {
    expect(MAP_SIZE_PRESETS.social).toBeDefined();
    expect(MAP_SIZE_PRESETS.social.size).toBe('600x315');
    expect(MAP_SIZE_PRESETS.social.scale).toBe(2);
  });
});

describe('buildGoogleMapsUrl', () => {
  const geojson = {
    type: 'FeatureCollection' as const,
    features: [{
      type: 'Feature' as const,
      properties: { slug: 'test-path', _fid: '100' },
      geometry: {
        type: 'LineString' as const,
        coordinates: [[-75.7, 45.4], [-75.6, 45.3], [-75.5, 45.2]],
      },
    }],
  };

  it('builds a valid Google Static Maps URL', () => {
    const url = buildGoogleMapsUrl([geojson], 'test-path', 'social', 'TEST_KEY');
    expect(url).toContain('maps.googleapis.com/maps/api/staticmap');
    expect(url).toContain('key=TEST_KEY');
    expect(url).toContain('size=600x315');
    expect(url).toContain('scale=2');
    expect(url).toContain('enc:');
    expect(url).not.toContain('markers=');
  });

  it('filters features by slug', () => {
    const mixed = {
      type: 'FeatureCollection' as const,
      features: [
        { type: 'Feature' as const, properties: { slug: 'test-path', _fid: '100' }, geometry: { type: 'LineString' as const, coordinates: [[-75.7, 45.4], [-75.6, 45.3]] } },
        { type: 'Feature' as const, properties: { slug: 'other-path', _fid: '200' }, geometry: { type: 'LineString' as const, coordinates: [[-74.0, 44.0], [-74.1, 44.1]] } },
      ],
    };
    const url = buildGoogleMapsUrl([mixed], 'test-path', 'social', 'TEST_KEY');
    expect(url).toBeDefined();
    expect(url!.length).toBeGreaterThan(0);
  });

  it('deduplicates features by _fid across tiles', () => {
    const tile1 = {
      type: 'FeatureCollection' as const,
      features: [{ type: 'Feature' as const, properties: { slug: 'my-path', _fid: '100' }, geometry: { type: 'LineString' as const, coordinates: [[-75.7, 45.4], [-75.6, 45.3]] } }],
    };
    const tile2 = {
      type: 'FeatureCollection' as const,
      features: [{ type: 'Feature' as const, properties: { slug: 'my-path', _fid: '100' }, geometry: { type: 'LineString' as const, coordinates: [[-75.7, 45.4], [-75.6, 45.3]] } }],
    };
    const url = buildGoogleMapsUrl([tile1, tile2], 'my-path', 'social', 'TEST_KEY');
    expect(url).toBeDefined();
  });

  it('returns null when no matching features found', () => {
    const url = buildGoogleMapsUrl([geojson], 'nonexistent', 'social', 'TEST_KEY');
    expect(url).toBeNull();
  });
});

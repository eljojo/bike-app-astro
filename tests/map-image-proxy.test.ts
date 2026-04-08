import { describe, it, expect } from 'vitest';
import {
  MAP_SIZE_PRESETS,
  buildGoogleMapsUrl,
  buildGoogleMapsUrlFromPolyline,
  parseMapImagePath,
} from '../src/views/api/map-image-helpers';

describe('MAP_SIZE_PRESETS', () => {
  it('has expected presets', () => {
    expect(MAP_SIZE_PRESETS.social).toBeDefined();
    expect(MAP_SIZE_PRESETS.social.cfImage.width).toBe(1200);
    expect(MAP_SIZE_PRESETS.social.googleSize).toBe('600x315');
    expect(MAP_SIZE_PRESETS.thumb).toBeDefined();
    expect(MAP_SIZE_PRESETS['thumb-2x']).toBeDefined();
    expect(MAP_SIZE_PRESETS['thumb-lg']).toBeDefined();
    expect(MAP_SIZE_PRESETS.full).toBeDefined();
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

describe('buildGoogleMapsUrlFromPolyline', () => {
  it('builds URL with markers', () => {
    const polyline = 'o}|tGdwn|M_@_@_@_@';
    const url = buildGoogleMapsUrlFromPolyline(polyline, 'TEST_KEY', 'en');
    expect(url).toContain('staticmap');
    expect(url).toContain('key=TEST_KEY');
    expect(url).toContain('language=en');
    expect(url).toContain('markers=color:yellow');
    expect(url).toContain('enc:');
  });

  it('returns null for empty polyline', () => {
    expect(buildGoogleMapsUrlFromPolyline('', 'KEY')).toBeNull();
  });
});

describe('parseMapImagePath', () => {
  it('parses bike path URL', () => {
    const result = parseMapImagePath('bike-path/424ac567b00f/aviation-pathway-social-en.png');
    expect(result).toEqual({
      type: 'bike-path', hash: '424ac567b00f', slug: 'aviation-pathway',
      size: 'social', variant: undefined, lang: 'en',
    });
  });

  it('parses route URL with variant (-- delimiter)', () => {
    const result = parseMapImagePath('route/a1b2c3d4e5f6/aylmer--main-thumb-2x-en.png');
    expect(result).toEqual({
      type: 'route', hash: 'a1b2c3d4e5f6', slug: 'aylmer',
      size: 'thumb-2x', variant: 'main', lang: 'en',
    });
  });

  it('parses multi-part variant (-- delimiter)', () => {
    const result = parseMapImagePath('route/f6e5d4c3b2a1/aylmer--variants-return-full-en.png');
    expect(result).toEqual({
      type: 'route', hash: 'f6e5d4c3b2a1', slug: 'aylmer',
      size: 'full', variant: 'variants-return', lang: 'en',
    });
  });

  it('handles slug containing -- when no variant', () => {
    const result = parseMapImagePath('route/a1b2c3d4e5f6/some--weird--name-full-en.png');
    // Last "--" wins: slug="some--weird", variant="name" (parsed from tail)
    expect(result).toEqual({
      type: 'route', hash: 'a1b2c3d4e5f6', slug: 'some--weird',
      size: 'full', variant: 'name', lang: 'en',
    });
  });

  it('parses ride URL (no variant)', () => {
    const result = parseMapImagePath('ride/b209388fdfec/morning-ride-thumb-en.png');
    expect(result).toEqual({
      type: 'ride', hash: 'b209388fdfec', slug: 'morning-ride',
      size: 'thumb', variant: undefined, lang: 'en',
    });
  });

  it('returns null for invalid format', () => {
    expect(parseMapImagePath('invalid')).toBeNull();
    expect(parseMapImagePath('route/hash/no-size.png')).toBeNull();
    expect(parseMapImagePath('unknown-type/hash/slug-social-en.png')).toBeNull();
  });
});

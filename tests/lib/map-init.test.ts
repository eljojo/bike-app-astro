import { describe, it, expect } from 'vitest';
import { decodeToGeoJson, buildPolylineFeature, photoPopupMaxWidth } from '../../src/lib/map-init';

describe('map-init helpers', () => {
  it('decodes an encoded polyline to GeoJSON coordinates', () => {
    // Encoded polyline for roughly [(38.5, -120.2), (40.7, -120.95), (43.252, -126.453)]
    const encoded = '_p~iF~ps|U_ulLnnqC_mqNvxq`@';
    const geojson = decodeToGeoJson(encoded);
    expect(geojson.type).toBe('Feature');
    expect(geojson.geometry.type).toBe('LineString');
    expect(geojson.geometry.coordinates.length).toBe(3);
    // GeoJSON is [lng, lat], polyline decodes to [lat, lng]
    expect(geojson.geometry.coordinates[0][0]).toBeCloseTo(-120.2, 1);
    expect(geojson.geometry.coordinates[0][1]).toBeCloseTo(38.5, 1);
  });

  it('builds a polyline feature with popup', () => {
    const feature = buildPolylineFeature('_p~iF~ps|U_ulLnnqC', 'Test Route');
    expect(feature.properties?.popup).toBe('Test Route');
    expect(feature.geometry.type).toBe('LineString');
  });
});

describe('photoPopupMaxWidth', () => {
  it('returns 100 at zoom 8 (minimum)', () => {
    expect(photoPopupMaxWidth(8)).toBe(100);
  });

  it('returns 500 at zoom 16 (maximum)', () => {
    expect(photoPopupMaxWidth(16)).toBe(500);
  });

  it('clamps to 100 below zoom 8', () => {
    expect(photoPopupMaxWidth(5)).toBe(100);
    expect(photoPopupMaxWidth(0)).toBe(100);
  });

  it('clamps to 500 above zoom 16', () => {
    expect(photoPopupMaxWidth(18)).toBe(500);
    expect(photoPopupMaxWidth(20)).toBe(500);
  });

  it('grows quadratically — midpoint is less than linear midpoint', () => {
    const mid = photoPopupMaxWidth(12); // t=0.5, quadratic → 100 + 400*0.25 = 200
    expect(mid).toBe(200);
    // Linear midpoint would be 300 — quadratic is less
    expect(mid).toBeLessThan(300);
  });

  it('returns integer values', () => {
    for (let z = 6; z <= 18; z++) {
      expect(Number.isInteger(photoPopupMaxWidth(z))).toBe(true);
    }
  });
});

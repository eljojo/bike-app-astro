import { describe, it, expect } from 'vitest';
import { decodeToGeoJson, buildPolylineFeature } from '../../src/lib/map-init';

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

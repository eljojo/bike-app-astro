// tests/polyline-layer.test.ts
import { describe, it, expect } from 'vitest';
import { buildPolylineFeature } from '../src/lib/maps/map-init';

describe('polyline layer helpers', () => {
  it('buildPolylineFeature decodes polyline and stores popup/color in properties', () => {
    // Encode a simple line: (38.5, -120.2) to (40.7, -120.95) to (43.252, -126.453)
    const encoded = '_p~iF~ps|U_ulLnnqC_mqNvxq`@';
    const feature = buildPolylineFeature(encoded, '<b>Test</b>', '#FF0000');

    expect(feature.type).toBe('Feature');
    expect(feature.geometry.type).toBe('LineString');
    expect(feature.geometry.coordinates.length).toBe(3);
    expect(feature.geometry.coordinates[0][0]).toBeCloseTo(-120.2, 1);
    expect(feature.geometry.coordinates[0][1]).toBeCloseTo(38.5, 1);
    expect(feature.properties).toEqual({ popup: '<b>Test</b>', color: '#FF0000' });
  });

  it('buildPolylineFeature omits color when not provided', () => {
    const encoded = '_p~iF~ps|U_ulLnnqC_mqNvxq`@';
    const feature = buildPolylineFeature(encoded, 'test');
    expect(feature.properties).toEqual({ popup: 'test' });
  });
});

import { describe, it, expect } from 'vitest';
import { resolveSegmentFromClick } from '../../../src/lib/maps/layers/tile-path-interactions';
import type { Feature, MultiLineString } from 'geojson';

function featureWithSegments(
  lines: Array<Array<[number, number]>>,
  segments: Array<{ name?: string; lineCount: number }>,
): Feature<MultiLineString> {
  return {
    type: 'Feature',
    properties: {
      _segments: segments.map(s => ({
        name: s.name,
        surface_mix: [{ value: 'asphalt', km: 1.0 }],
        lineCount: s.lineCount,
      })),
    },
    geometry: {
      type: 'MultiLineString',
      coordinates: lines,
    },
  };
}

describe('resolveSegmentFromClick', () => {
  it('returns undefined when the feature has no _segments', () => {
    const feature: Feature<MultiLineString> = {
      type: 'Feature',
      properties: {},
      geometry: { type: 'MultiLineString', coordinates: [[[-75.7, 45.4], [-75.69, 45.4]]] },
    };
    expect(resolveSegmentFromClick(feature, { lng: -75.695, lat: 45.4 })).toBeUndefined();
  });

  it('returns undefined for an empty _segments array', () => {
    const feature = featureWithSegments([[[-75.7, 45.4], [-75.69, 45.4]]], []);
    expect(resolveSegmentFromClick(feature, { lng: -75.695, lat: 45.4 })).toBeUndefined();
  });

  it('resolves a click near the first sub-line to the first segment', () => {
    const feature = featureWithSegments(
      [
        [[-75.70, 45.40], [-75.69, 45.40]], // line 0 — belongs to segment A
        [[-75.69, 45.40], [-75.68, 45.40]], // line 1 — belongs to segment B
      ],
      [
        { name: 'Alpha', lineCount: 1 },
        { name: 'Beta', lineCount: 1 },
      ],
    );
    const resolved = resolveSegmentFromClick(feature, { lng: -75.695, lat: 45.4 });
    expect(resolved?.name).toBe('Alpha');
  });

  it('resolves a click near the last sub-line to the last segment', () => {
    const feature = featureWithSegments(
      [
        [[-75.70, 45.40], [-75.69, 45.40]],
        [[-75.69, 45.40], [-75.68, 45.40]],
        [[-75.68, 45.40], [-75.67, 45.40]],
      ],
      [
        { name: 'Alpha', lineCount: 1 },
        { name: 'Beta', lineCount: 1 },
        { name: 'Gamma', lineCount: 1 },
      ],
    );
    const resolved = resolveSegmentFromClick(feature, { lng: -75.675, lat: 45.4 });
    expect(resolved?.name).toBe('Gamma');
  });

  it('resolves a click inside a multi-line segment to that segment', () => {
    const feature = featureWithSegments(
      [
        [[-75.70, 45.40], [-75.69, 45.40]], // line 0 — segment A (2 lines)
        [[-75.69, 45.40], [-75.68, 45.40]], // line 1 — segment A
        [[-75.68, 45.40], [-75.67, 45.40]], // line 2 — segment B
      ],
      [
        { name: 'Alpha', lineCount: 2 },
        { name: 'Beta',  lineCount: 1 },
      ],
    );
    // Click on line 1, the second line of Alpha
    const resolved = resolveSegmentFromClick(feature, { lng: -75.685, lat: 45.4 });
    expect(resolved?.name).toBe('Alpha');
  });

  it('handles a LineString geometry (not just MultiLineString)', () => {
    const feature: Feature<any> = {
      type: 'Feature',
      properties: {
        _segments: [{
          name: 'Solo',
          surface_mix: [{ value: 'asphalt', km: 1.0 }],
          lineCount: 1,
        }],
      },
      geometry: {
        type: 'LineString',
        coordinates: [[-75.70, 45.40], [-75.69, 45.40]],
      },
    };
    const resolved = resolveSegmentFromClick(feature, { lng: -75.695, lat: 45.4 });
    expect(resolved?.name).toBe('Solo');
  });
});

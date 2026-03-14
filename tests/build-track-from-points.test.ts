import { describe, it, expect } from 'vitest';
import { buildTrackFromPoints } from '../src/lib/gpx';
import type { GpxPoint } from '../src/lib/gpx';

describe('buildTrackFromPoints', () => {
  const samplePoints: GpxPoint[] = [
    { lat: 45.4215, lon: -75.6972, ele: 70 },
    { lat: 45.4315, lon: -75.6872, ele: 80 },
    { lat: 45.4415, lon: -75.6772, ele: 75 },
  ];

  it('computes distance from points', () => {
    const track = buildTrackFromPoints(samplePoints);
    expect(track.distance_m).toBeGreaterThan(0);
    expect(track.points).toHaveLength(3);
  });

  it('computes elevation gain correctly', () => {
    const track = buildTrackFromPoints(samplePoints);
    // 70→80 = +10, 80→75 = no gain
    expect(track.elevation_gain_m).toBe(10);
  });

  it('generates encoded polyline', () => {
    const track = buildTrackFromPoints(samplePoints);
    expect(track.polyline).toBeTruthy();
    expect(typeof track.polyline).toBe('string');
  });

  it('returns empty track for no points', () => {
    const track = buildTrackFromPoints([]);
    expect(track.distance_m).toBe(0);
    expect(track.elevation_gain_m).toBe(0);
    expect(track.polyline).toBe('');
    expect(track.points).toHaveLength(0);
  });

  it('handles single point', () => {
    const track = buildTrackFromPoints([samplePoints[0]]);
    expect(track.distance_m).toBe(0);
    expect(track.points).toHaveLength(1);
    expect(track.polyline).toBeTruthy();
  });

  it('recomputes metrics after filtering (fewer points = shorter distance)', () => {
    const fullTrack = buildTrackFromPoints(samplePoints);
    const partialTrack = buildTrackFromPoints(samplePoints.slice(0, 2));
    expect(partialTrack.distance_m).toBeLessThan(fullTrack.distance_m);
  });

  it('computes time-based metrics with timestamps', () => {
    const pointsWithTime: GpxPoint[] = [
      { lat: 45.4215, lon: -75.6972, ele: 70, time: '2025-03-01T10:00:00Z' },
      { lat: 45.4315, lon: -75.6872, ele: 80, time: '2025-03-01T10:05:00Z' },
      { lat: 45.4415, lon: -75.6772, ele: 75, time: '2025-03-01T10:10:00Z' },
    ];
    const track = buildTrackFromPoints(pointsWithTime);
    expect(track.elapsed_time_s).toBe(600); // 10 minutes
    expect(track.moving_time_s).toBeGreaterThan(0);
    expect(track.average_speed_kmh).toBeGreaterThan(0);
  });
});

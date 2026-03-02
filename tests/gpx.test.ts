import { describe, it, expect } from 'vitest';
import { parseGpx } from '../src/lib/gpx';

const SAMPLE_GPX = `<?xml version="1.0"?>
<gpx version="1.1">
  <trk><trkseg>
    <trkpt lat="45.4215" lon="-75.6972"><ele>70</ele></trkpt>
    <trkpt lat="45.4315" lon="-75.6872"><ele>80</ele></trkpt>
    <trkpt lat="45.4415" lon="-75.6772"><ele>75</ele></trkpt>
  </trkseg></trk>
</gpx>`;

describe('parseGpx', () => {
  it('extracts points from GPX XML', () => {
    const track = parseGpx(SAMPLE_GPX);
    expect(track.points).toHaveLength(3);
    expect(track.points[0].lat).toBeCloseTo(45.4215);
    expect(track.points[0].ele).toBe(70);
  });

  it('computes distance in meters', () => {
    const track = parseGpx(SAMPLE_GPX);
    expect(track.distance_m).toBeGreaterThan(0);
  });

  it('computes elevation gain', () => {
    const track = parseGpx(SAMPLE_GPX);
    expect(track.elevation_gain_m).toBe(10); // 70->80 = +10, 80->75 = 0
  });

  it('generates encoded polyline', () => {
    const track = parseGpx(SAMPLE_GPX);
    expect(track.polyline).toBeTruthy();
    expect(typeof track.polyline).toBe('string');
  });

  it('handles empty GPX gracefully', () => {
    const track = parseGpx('<gpx></gpx>');
    expect(track.points).toHaveLength(0);
    expect(track.distance_m).toBe(0);
  });

  it('computes max gradient percentage over 100m windows', () => {
    // Build GPX with a steep section: 10m rise over ~100m horizontal
    const steepGpx = `<?xml version="1.0"?>
<gpx><trk><trkseg>
  <trkpt lat="45.4215" lon="-75.6972"><ele>70</ele></trkpt>
  <trkpt lat="45.4220" lon="-75.6972"><ele>70</ele></trkpt>
  <trkpt lat="45.4225" lon="-75.6972"><ele>70</ele></trkpt>
  <trkpt lat="45.4230" lon="-75.6972"><ele>80</ele></trkpt>
  <trkpt lat="45.4235" lon="-75.6972"><ele>80</ele></trkpt>
</trkseg></trk></gpx>`;
    const track = parseGpx(steepGpx);
    expect(track.max_gradient_pct).toBeGreaterThan(5);
    expect(track.max_gradient_pct).toBeLessThan(25);
  });

  it('returns 0 max gradient for flat track', () => {
    const flatGpx = `<?xml version="1.0"?>
<gpx><trk><trkseg>
  <trkpt lat="45.4215" lon="-75.6972"><ele>70</ele></trkpt>
  <trkpt lat="45.4220" lon="-75.6972"><ele>70</ele></trkpt>
  <trkpt lat="45.4225" lon="-75.6972"><ele>70</ele></trkpt>
</trkseg></trk></gpx>`;
    const track = parseGpx(flatGpx);
    expect(track.max_gradient_pct).toBe(0);
  });
});

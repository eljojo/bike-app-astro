import { describe, it, expect } from 'vitest';
import { parseGpx, extractRwgpsUrl, computeElapsedTime, computeMovingTime, extractRideDate } from '../src/lib/gpx';
import type { GpxPoint } from '../src/lib/gpx';

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

describe('extractRwgpsUrl', () => {
  it('extracts URL from metadata link with ridewithgps creator', () => {
    const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx creator="https://ridewithgps.com" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <link href="https://ridewithgps.com/routes/12345">
      <text>some route</text>
    </link>
  </metadata>
  <trk><trkseg><trkpt lat="45.0" lon="-75.0"></trkpt></trkseg></trk>
</gpx>`;
    expect(extractRwgpsUrl(gpx)).toBe('https://ridewithgps.com/routes/12345');
  });

  it('extracts URL from metadata link even without creator hint', () => {
    const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx creator="other" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <link href="https://ridewithgps.com/routes/99999">
      <text>my route</text>
    </link>
  </metadata>
  <trk><trkseg><trkpt lat="45.0" lon="-75.0"></trkpt></trkseg></trk>
</gpx>`;
    expect(extractRwgpsUrl(gpx)).toBe('https://ridewithgps.com/routes/99999');
  });

  it('returns null when no RWGPS reference found', () => {
    const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx creator="http://ottawabybike.ca" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>test</name></metadata>
  <trk><trkseg><trkpt lat="45.0" lon="-75.0"></trkpt></trkseg></trk>
</gpx>`;
    expect(extractRwgpsUrl(gpx)).toBeNull();
  });

  it('handles multiple metadata links, picks RWGPS one', () => {
    const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <link href="https://example.com"><text>example</text></link>
    <link href="https://ridewithgps.com/routes/555"><text>rwgps</text></link>
  </metadata>
  <trk><trkseg><trkpt lat="45.0" lon="-75.0"></trkpt></trkseg></trk>
</gpx>`;
    expect(extractRwgpsUrl(gpx)).toBe('https://ridewithgps.com/routes/555');
  });
});

// GPX with timestamps: 3 points over 60 seconds, ~1.5 km apart
const TIMED_GPX = `<?xml version="1.0"?>
<gpx version="1.1">
  <trk><trkseg>
    <trkpt lat="45.4215" lon="-75.6972"><ele>70</ele><time>2025-06-15T10:00:00Z</time></trkpt>
    <trkpt lat="45.4315" lon="-75.6872"><ele>80</ele><time>2025-06-15T10:00:30Z</time></trkpt>
    <trkpt lat="45.4415" lon="-75.6772"><ele>75</ele><time>2025-06-15T10:01:00Z</time></trkpt>
  </trkseg></trk>
</gpx>`;

// GPX with a stationary stop in the middle
const TIMED_WITH_STOP_GPX = `<?xml version="1.0"?>
<gpx version="1.1">
  <trk><trkseg>
    <trkpt lat="45.4215" lon="-75.6972"><ele>70</ele><time>2025-06-15T10:00:00Z</time></trkpt>
    <trkpt lat="45.4315" lon="-75.6872"><ele>80</ele><time>2025-06-15T10:00:30Z</time></trkpt>
    <trkpt lat="45.4315" lon="-75.6872"><ele>80</ele><time>2025-06-15T10:05:30Z</time></trkpt>
    <trkpt lat="45.4415" lon="-75.6772"><ele>75</ele><time>2025-06-15T10:06:00Z</time></trkpt>
  </trkseg></trk>
</gpx>`;

describe('computeElapsedTime', () => {
  it('returns seconds between first and last timestamp', () => {
    const points: GpxPoint[] = [
      { lat: 45.42, lon: -75.69, time: '2025-06-15T10:00:00Z' },
      { lat: 45.43, lon: -75.68, time: '2025-06-15T10:00:30Z' },
      { lat: 45.44, lon: -75.67, time: '2025-06-15T10:01:00Z' },
    ];
    expect(computeElapsedTime(points)).toBe(60);
  });

  it('returns 0 when no timestamps present', () => {
    const points: GpxPoint[] = [
      { lat: 45.42, lon: -75.69 },
      { lat: 45.43, lon: -75.68 },
    ];
    expect(computeElapsedTime(points)).toBe(0);
  });

  it('returns 0 for a single point with timestamp', () => {
    const points: GpxPoint[] = [
      { lat: 45.42, lon: -75.69, time: '2025-06-15T10:00:00Z' },
    ];
    expect(computeElapsedTime(points)).toBe(0);
  });

  it('returns 0 for empty array', () => {
    expect(computeElapsedTime([])).toBe(0);
  });
});

describe('computeMovingTime', () => {
  it('counts all segments when continuously moving', () => {
    const points: GpxPoint[] = [
      { lat: 45.4215, lon: -75.6972, time: '2025-06-15T10:00:00Z' },
      { lat: 45.4315, lon: -75.6872, time: '2025-06-15T10:00:30Z' },
      { lat: 45.4415, lon: -75.6772, time: '2025-06-15T10:01:00Z' },
    ];
    // All segments are fast-moving (~1.5 km in 30s each), so all time counts
    expect(computeMovingTime(points)).toBe(60);
  });

  it('excludes stationary segments', () => {
    const points: GpxPoint[] = [
      { lat: 45.4215, lon: -75.6972, time: '2025-06-15T10:00:00Z' },
      { lat: 45.4315, lon: -75.6872, time: '2025-06-15T10:00:30Z' },
      // Same location, 5 minutes later — stationary stop
      { lat: 45.4315, lon: -75.6872, time: '2025-06-15T10:05:30Z' },
      { lat: 45.4415, lon: -75.6772, time: '2025-06-15T10:06:00Z' },
    ];
    const moving = computeMovingTime(points);
    // Should exclude the 300s stationary segment, keep the two 30s moving segments
    expect(moving).toBe(60);
  });

  it('returns 0 when no timestamps present', () => {
    const points: GpxPoint[] = [
      { lat: 45.42, lon: -75.69 },
      { lat: 45.43, lon: -75.68 },
    ];
    expect(computeMovingTime(points)).toBe(0);
  });

  it('returns 0 for empty array', () => {
    expect(computeMovingTime([])).toBe(0);
  });
});

describe('parseGpx time fields', () => {
  it('extracts time from trackpoints', () => {
    const track = parseGpx(TIMED_GPX);
    expect(track.points[0].time).toBe('2025-06-15T10:00:00Z');
    expect(track.points[2].time).toBe('2025-06-15T10:01:00Z');
  });

  it('computes elapsed_time_s from timestamps', () => {
    const track = parseGpx(TIMED_GPX);
    expect(track.elapsed_time_s).toBe(60);
  });

  it('computes moving_time_s excluding stops', () => {
    const track = parseGpx(TIMED_WITH_STOP_GPX);
    // 360s elapsed but only 60s moving (two 30s moving segments, one 300s stop)
    expect(track.elapsed_time_s).toBe(360);
    expect(track.moving_time_s).toBe(60);
  });

  it('computes average_speed_kmh from distance and moving time', () => {
    const track = parseGpx(TIMED_GPX);
    // distance is ~2.8 km over 60s of moving time
    expect(track.average_speed_kmh).toBeGreaterThan(50);
    // Sanity: should be less than 300 km/h
    expect(track.average_speed_kmh).toBeLessThan(300);
  });

  it('returns 0 for all time fields when no timestamps', () => {
    const track = parseGpx(SAMPLE_GPX);
    expect(track.elapsed_time_s).toBe(0);
    expect(track.moving_time_s).toBe(0);
    expect(track.average_speed_kmh).toBe(0);
  });

  it('returns 0 for all time fields on empty GPX', () => {
    const track = parseGpx('<gpx></gpx>');
    expect(track.elapsed_time_s).toBe(0);
    expect(track.moving_time_s).toBe(0);
    expect(track.average_speed_kmh).toBe(0);
  });
});

describe('extractRideDate', () => {
  it('extracts date from first trackpoint time element', () => {
    const gpx = `<?xml version="1.0"?>
      <gpx><trk><trkseg>
        <trkpt lat="45.0" lon="-75.0"><time>2026-01-23T14:30:00Z</time></trkpt>
        <trkpt lat="45.1" lon="-75.1"><time>2026-01-23T15:00:00Z</time></trkpt>
      </trkseg></trk></gpx>`;
    expect(extractRideDate(gpx)).toBe('2026-01-23');
  });

  it('returns null when no time elements exist', () => {
    const gpx = `<?xml version="1.0"?>
      <gpx><trk><trkseg>
        <trkpt lat="45.0" lon="-75.0"></trkpt>
      </trkseg></trk></gpx>`;
    expect(extractRideDate(gpx)).toBeNull();
  });

  it('handles timezone offsets correctly', () => {
    const gpx = `<?xml version="1.0"?>
      <gpx><trk><trkseg>
        <trkpt lat="45.0" lon="-75.0"><time>2026-01-23T23:30:00+05:00</time></trkpt>
      </trkseg></trk></gpx>`;
    expect(extractRideDate(gpx)).toBe('2026-01-23');
  });

  it('prefers trackpoint time over metadata time', () => {
    const gpx = `<?xml version="1.0"?>
    <gpx><metadata><time>2020-01-01T00:00:00Z</time></metadata>
    <trk><trkseg>
      <trkpt lat="45.0" lon="-75.0"><time>2026-01-23T14:30:00Z</time></trkpt>
    </trkseg></trk></gpx>`;
    expect(extractRideDate(gpx)).toBe('2026-01-23');
  });

  it('falls back to metadata time when no trackpoint time exists', () => {
    const gpx = `<?xml version="1.0"?>
    <gpx><metadata><time>2026-03-01T00:00:00Z</time></metadata>
    <trk><trkseg>
      <trkpt lat="45.0" lon="-75.0"></trkpt>
    </trkseg></trk></gpx>`;
    expect(extractRideDate(gpx)).toBe('2026-03-01');
  });
});

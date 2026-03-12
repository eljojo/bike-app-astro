import { describe, it, expect } from 'vitest';
import { buildGpxFromStravaStreams, parseStravaActivityUrl } from '../src/lib/strava-api';

describe('parseStravaActivityUrl', () => {
  it('extracts activity ID from standard URL', () => {
    expect(parseStravaActivityUrl('https://www.strava.com/activities/12345678'))
      .toEqual({ activityId: '12345678' });
  });

  it('handles trailing slash', () => {
    expect(parseStravaActivityUrl('https://strava.com/activities/12345678/'))
      .toEqual({ activityId: '12345678' });
  });

  it('returns null for non-Strava URLs', () => {
    expect(parseStravaActivityUrl('https://example.com/activities/123')).toBeNull();
  });

  it('returns null for non-activity Strava URLs', () => {
    expect(parseStravaActivityUrl('https://strava.com/routes/123')).toBeNull();
  });
});

describe('buildGpxFromStravaStreams', () => {
  it('creates GPX with lat/lng/ele/time from activity streams', () => {
    const streams = {
      latlng: { data: [[45.0, -75.0], [45.1, -75.1]] as [number, number][] },
      altitude: { data: [60, 70] },
      time: { data: [0, 100] },
    };
    const startTime = new Date('2026-03-12T10:00:00Z');
    const gpx = buildGpxFromStravaStreams('Morning Ride', streams, startTime);

    expect(gpx).toContain('<name>Morning Ride</name>');
    expect(gpx).toContain('lat="45"');
    expect(gpx).toContain('lon="-75"');
    expect(gpx).toContain('<ele>60</ele>');
    expect(gpx).toContain('<time>2026-03-12T10:00:00.000Z</time>');
    expect(gpx).toContain('<time>2026-03-12T10:01:40.000Z</time>'); // +100s
  });

  it('escapes XML special characters in name', () => {
    const streams = {
      latlng: { data: [[45.0, -75.0]] as [number, number][] },
      altitude: { data: [60] },
      time: { data: [0] },
    };
    const gpx = buildGpxFromStravaStreams('Ride & Fun <3', streams, new Date());
    expect(gpx).toContain('Ride &amp; Fun &lt;3');
  });

  it('handles missing altitude data', () => {
    const streams = {
      latlng: { data: [[45.0, -75.0]] as [number, number][] },
      time: { data: [0] },
    };
    const gpx = buildGpxFromStravaStreams('Test', streams, new Date());
    expect(gpx).toContain('lat="45"');
    expect(gpx).not.toContain('<ele>');
  });
});

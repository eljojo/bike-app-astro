import { describe, it, expect } from 'vitest';
import { rideDetailFromCache, rideDetailToCache } from '../src/lib/models/ride-model';
import type { RideDetail } from '../src/lib/models/ride-model';
import { computeRideContentHash } from '../src/lib/models/ride-model.server';

const sampleDetail: RideDetail = {
  slug: '2026-01-23-winter-ride',
  name: 'Winter Ride',
  tagline: '',
  tags: [],
  status: 'published',
  body: 'A cold but beautiful ride.',
  media: [{ key: 'abc123', caption: 'Snow', cover: true }],
  variants: [{ name: 'main', gpx: '23-winter-ride.gpx', distance_km: 42 }],
  contentHash: 'hash123',
  ride_date: '2026-01-23',
  country: 'Canada',
  highlight: true,
};

describe('rideDetailToCache + rideDetailFromCache', () => {
  it('round-trips through JSON serialization', () => {
    const cached = rideDetailToCache(sampleDetail);
    const parsed = rideDetailFromCache(cached);
    expect(parsed.name).toBe('Winter Ride');
    expect(parsed.ride_date).toBe('2026-01-23');
    expect(parsed.country).toBe('Canada');
    expect(parsed.highlight).toBe(true);
    expect(parsed.media).toHaveLength(1);
    expect(parsed.variants).toHaveLength(1);
  });

  it('throws for invalid JSON', () => {
    expect(() => rideDetailFromCache('not json')).toThrow();
  });

  it('throws for data missing required fields', () => {
    expect(() => rideDetailFromCache(JSON.stringify({ name: 'only name' }))).toThrow();
  });

  it('round-trips strava_id and privacy_zone fields', () => {
    const withStrava: RideDetail = {
      ...sampleDetail,
      strava_id: '1234567890',
      privacy_zone: true,
    };
    const cached = rideDetailToCache(withStrava);
    const parsed = rideDetailFromCache(cached);
    expect(parsed.strava_id).toBe('1234567890');
    expect(parsed.privacy_zone).toBe(true);
  });

  it('handles missing strava_id and privacy_zone (optional)', () => {
    const cached = rideDetailToCache(sampleDetail);
    const parsed = rideDetailFromCache(cached);
    expect(parsed.strava_id).toBeUndefined();
    expect(parsed.privacy_zone).toBeUndefined();
  });
});

describe('computeRideContentHash', () => {
  it('produces deterministic hash', () => {
    const hash1 = computeRideContentHash('sidecar', 'gpx', 'media');
    const hash2 = computeRideContentHash('sidecar', 'gpx', 'media');
    expect(hash1).toBe(hash2);
  });

  it('differs when arguments change', () => {
    const hash1 = computeRideContentHash('sidecar', 'gpx', 'media');
    const hash2 = computeRideContentHash('different', 'gpx', 'media');
    expect(hash1).not.toBe(hash2);
  });
});

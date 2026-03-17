import { describe, it, expect } from 'vitest';
import { rideDetailFromCache, rideDetailToCache } from '../src/lib/models/ride-model';
import type { RideDetail } from '../src/lib/models/ride-model';
import { computeRideContentHash, rideDetailFromGit } from '../src/lib/models/ride-model.server';

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

describe('rideDetailFromGit media parsing', () => {
  it('preserves video media items alongside photos', () => {
    const mediaYaml = [
      '- type: photo',
      '  key: abc123',
      '  caption: A photo',
      '- type: video',
      '  key: vid456',
      '  title: A video',
      '  duration: "00:01:30"',
      '  orientation: landscape',
      '  width: 1920',
      '  height: 1080',
    ].join('\n');

    const detail = rideDetailFromGit('test-ride', { name: 'Test' }, '', undefined, mediaYaml);
    expect(detail.media).toHaveLength(2);

    const photo = detail.media.find(m => m.key === 'abc123');
    expect(photo).toBeDefined();
    expect(photo!.caption).toBe('A photo');

    const video = detail.media.find(m => m.key === 'vid456');
    expect(video).toBeDefined();
    expect(video!.title).toBe('A video');
    expect(video!.duration).toBe('00:01:30');
    expect(video!.orientation).toBe('landscape');
    expect(video!.width).toBe(1920);
    expect(video!.height).toBe(1080);
  });

  it('preserves items without explicit type', () => {
    const mediaYaml = [
      '- key: legacy123',
      '  caption: Legacy item',
    ].join('\n');

    const detail = rideDetailFromGit('test-ride', { name: 'Test' }, '', undefined, mediaYaml);
    expect(detail.media).toHaveLength(1);
    expect(detail.media[0].key).toBe('legacy123');
    expect(detail.media[0].caption).toBe('Legacy item');
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

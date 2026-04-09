import { describe, it, expect } from 'vitest';
import { gpxHash } from '../src/lib/maps/map-generation.server';

// ---------------------------------------------------------------------------
// gpxHash
// ---------------------------------------------------------------------------
describe('gpxHash', () => {
  it('returns a 16-char hex string', () => {
    const hash = gpxHash('<gpx>content</gpx>');
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('returns the same hash for the same content (stability)', () => {
    const content = '<gpx>stable content</gpx>';
    expect(gpxHash(content)).toBe(gpxHash(content));
  });

  it('returns different hashes for different content (sensitivity)', () => {
    expect(gpxHash('<gpx>content A</gpx>')).not.toBe(gpxHash('<gpx>content B</gpx>'));
  });
});

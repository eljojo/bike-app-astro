import { describe, it, expect } from 'vitest';
import { extractCid, extractCoordinates } from '../../../src/views/api/places-prefill';

describe('extractCid', () => {
  it('extracts CID from hex format', () => {
    const url = 'https://www.google.com/maps/place/1s0x4cce04ff4fe8a1e1:0x3afed6c30e3e7f0a';
    expect(extractCid(url)).toBe(BigInt('0x3afed6c30e3e7f0a').toString());
  });

  it('extracts CID from ?cid= format', () => {
    expect(extractCid('https://maps.google.com/?cid=12345678901234')).toBe('12345678901234');
  });

  it('extracts CID from ftid format', () => {
    const url = 'https://maps.google.com/maps?ftid=0x4cce04ff4fe8a1e1:0x3afed6c30e3e7f0a';
    expect(extractCid(url)).toBe(BigInt('0x3afed6c30e3e7f0a').toString());
  });

  it('returns null for non-Google URLs', () => {
    expect(extractCid('https://example.com')).toBeNull();
  });
});

describe('extractCoordinates', () => {
  it('extracts lat/lng from @lat,lng format', () => {
    const url = 'https://www.google.com/maps/@45.421530,-75.697193,17z';
    expect(extractCoordinates(url)).toEqual({ lat: 45.421530, lng: -75.697193 });
  });

  it('returns null when no coordinates', () => {
    expect(extractCoordinates('https://maps.google.com/place/some-place')).toBeNull();
  });
});

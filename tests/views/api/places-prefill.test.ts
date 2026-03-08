import { describe, it, expect } from 'vitest';
import { extractCid, extractCoordinates, mapGoogleTypeToCategory } from '../../../src/views/api/places-prefill';

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

describe('mapGoogleTypeToCategory', () => {
  it('maps cafe type', () => {
    expect(mapGoogleTypeToCategory(['cafe'])).toBe('cafe');
  });

  it('maps restaurant type', () => {
    expect(mapGoogleTypeToCategory(['restaurant'])).toBe('restaurant');
  });

  it('maps bicycle_store to bike-shop', () => {
    expect(mapGoogleTypeToCategory(['bicycle_store'])).toBe('bike-shop');
  });

  it('maps bar to beer', () => {
    expect(mapGoogleTypeToCategory(['bar'])).toBe('beer');
  });

  it('maps park type', () => {
    expect(mapGoogleTypeToCategory(['park'])).toBe('park');
  });

  it('maps lodging to motel', () => {
    expect(mapGoogleTypeToCategory(['lodging'])).toBe('motel');
  });

  it('uses first matching type when multiple present', () => {
    expect(mapGoogleTypeToCategory(['point_of_interest', 'establishment', 'cafe'])).toBe('cafe');
  });

  it('returns null for unmapped types', () => {
    expect(mapGoogleTypeToCategory(['point_of_interest', 'establishment'])).toBeNull();
  });

  it('returns null for empty array', () => {
    expect(mapGoogleTypeToCategory([])).toBeNull();
  });
});

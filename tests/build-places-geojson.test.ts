import { describe, it, expect } from 'vitest';
import { buildPlacesGeoJSON } from '../src/build-data-plugin';

interface PlaceInput {
  name: string;
  category: string;
  lat: number;
  lng: number;
  status?: string;
  name_fr?: string;
  address?: string;
  website?: string;
  phone?: string;
  google_maps_url?: string;
  photo_key?: string;
  media?: Array<{ key: string; cover?: boolean }>;
  organizer_name?: string;
  organizer_url?: string;
}

function makePlace(overrides: Partial<PlaceInput> = {}): PlaceInput {
  return {
    name: 'Test Place',
    category: 'cafe',
    lat: 45.5,
    lng: -73.6,
    status: 'published',
    ...overrides,
  };
}

function makeMedia(overrides: Partial<{ key: string; lat: number; lng: number }> = {}) {
  return {
    key: 'photo-abc',
    lat: 45.5,
    lng: -73.6,
    ...overrides,
  };
}

describe('buildPlacesGeoJSON', () => {
  it('returns a valid FeatureCollection with Point geometry', () => {
    const result = buildPlacesGeoJSON([makePlace()], []);

    expect(result.type).toBe('FeatureCollection');
    expect(result.features).toHaveLength(1);
    expect(result.features[0].type).toBe('Feature');
    expect(result.features[0].geometry.type).toBe('Point');
    expect(result.features[0].geometry).toEqual({
      type: 'Point',
      coordinates: [-73.6, 45.5],
    });
  });

  it('includes core properties: name, emoji, category', () => {
    const result = buildPlacesGeoJSON([makePlace({ name: 'Good Cafe', category: 'cafe' })], []);
    const props = result.features[0].properties!;

    expect(props.name).toBe('Good Cafe');
    expect(props.emoji).toBe('☕');
    expect(props.category).toBe('cafe');
  });

  it('uses fallback emoji for unknown category', () => {
    const result = buildPlacesGeoJSON([makePlace({ category: 'unknown-thing' })], []);
    const props = result.features[0].properties!;

    expect(props.emoji).toBe('📍');
  });

  it('filters to published places only', () => {
    const places = [
      makePlace({ name: 'Published', status: 'published' }),
      makePlace({ name: 'Draft', status: 'draft' }),
      makePlace({ name: 'No Status', status: undefined }),
    ];
    const result = buildPlacesGeoJSON(places, []);

    expect(result.features).toHaveLength(2);
    const names = result.features.map(f => f.properties!.name);
    expect(names).toContain('Published');
    expect(names).toContain('No Status');
    expect(names).not.toContain('Draft');
  });

  it('includes optional fields when present', () => {
    const result = buildPlacesGeoJSON([makePlace({
      name_fr: 'Bon Café',
      address: '123 Main St',
      website: 'https://example.com',
      phone: '555-1234',
      google_maps_url: 'https://maps.google.com/?q=45.5,-73.6',
    })], []);
    const props = result.features[0].properties!;

    expect(props.name_fr).toBe('Bon Café');
    expect(props.address).toBe('123 Main St');
    expect(props.link).toBe('https://example.com');
    expect(props.phone).toBe('555-1234');
    expect(props.google_maps_url).toBe('https://maps.google.com/?q=45.5,-73.6');
  });

  it('omits optional fields when not present', () => {
    const result = buildPlacesGeoJSON([makePlace()], []);
    const props = result.features[0].properties!;

    expect(props).not.toHaveProperty('name_fr');
    expect(props).not.toHaveProperty('address');
    expect(props).not.toHaveProperty('link');
    expect(props).not.toHaveProperty('phone');
    expect(props).not.toHaveProperty('google_maps_url');
    expect(props).not.toHaveProperty('organizer_name');
    expect(props).not.toHaveProperty('organizer_url');
  });

  it('uses media cover key for photo_key', () => {
    const result = buildPlacesGeoJSON([makePlace({
      media: [
        { key: 'photo-1' },
        { key: 'photo-2', cover: true },
      ],
    })], []);
    const props = result.features[0].properties!;

    expect(props.photo_key).toBe('photo-2');
  });

  it('falls back to first media key when no cover', () => {
    const result = buildPlacesGeoJSON([makePlace({
      media: [{ key: 'photo-first' }, { key: 'photo-second' }],
    })], []);
    const props = result.features[0].properties!;

    expect(props.photo_key).toBe('photo-first');
  });

  it('uses standalone photo_key when no media array', () => {
    const result = buildPlacesGeoJSON([makePlace({ photo_key: 'standalone-key' })], []);
    const props = result.features[0].properties!;

    expect(props.photo_key).toBe('standalone-key');
  });

  it('assigns photo_key from nearest media within 750m', () => {
    const place = makePlace({ lat: 45.5, lng: -73.6 });
    const media = [
      makeMedia({ key: 'far-photo', lat: 45.51, lng: -73.6 }),   // ~1.1km away
      makeMedia({ key: 'near-photo', lat: 45.5005, lng: -73.6 }), // ~55m away
    ];
    const result = buildPlacesGeoJSON([place], media);
    const props = result.features[0].properties!;

    expect(props.photo_key).toBe('near-photo');
  });

  it('does not assign media photo if all are beyond 750m', () => {
    const place = makePlace({ lat: 45.5, lng: -73.6 });
    const media = [
      makeMedia({ key: 'far-photo', lat: 45.52, lng: -73.6 }), // ~2.2km away
    ];
    const result = buildPlacesGeoJSON([place], media);
    const props = result.features[0].properties!;

    expect(props).not.toHaveProperty('photo_key');
  });

  it('does not override existing photo_key with nearby media', () => {
    const place = makePlace({ photo_key: 'existing-key', lat: 45.5, lng: -73.6 });
    const media = [makeMedia({ key: 'nearby-photo', lat: 45.5001, lng: -73.6 })];
    const result = buildPlacesGeoJSON([place], media);
    const props = result.features[0].properties!;

    expect(props.photo_key).toBe('existing-key');
  });

  it('includes organizer_name and organizer_url when present', () => {
    const result = buildPlacesGeoJSON([makePlace({
      organizer_name: 'Bike Club',
      organizer_url: '/community/bike-club',
    })], []);
    const props = result.features[0].properties!;

    expect(props.organizer_name).toBe('Bike Club');
    expect(props.organizer_url).toBe('/community/bike-club');
  });

  it('returns empty FeatureCollection for empty input', () => {
    const result = buildPlacesGeoJSON([], []);

    expect(result.type).toBe('FeatureCollection');
    expect(result.features).toHaveLength(0);
  });
});

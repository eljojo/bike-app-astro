import { describe, it, expect } from 'vitest';
import { toMemberRef } from '../../src/lib/bike-paths/bike-path-entries.server';
import type { BikePathPage } from '../../src/lib/bike-paths/bike-path-entries.server';

function fakePage(overrides: Partial<BikePathPage> = {}): BikePathPage {
  return {
    slug: 'foo',
    name: 'Foo Path',
    tags: [],
    score: 0,
    hasMarkdown: false,
    listed: true,
    standalone: true,
    stub: false,
    featured: false,
    ymlEntries: [],
    osmRelationIds: [],
    osmNames: [],
    geoFiles: [],
    points: [],
    routeCount: 0,
    overlappingRoutes: [],
    nearbyPhotos: [],
    nearbyPlaces: [],
    nearbyPaths: [],
    connectedPaths: [],
    translations: {},
    ...overrides,
  } as BikePathPage;
}

describe('toMemberRef', () => {
  it('copies scalar fields from BikePathPage', () => {
    const page = fakePage({
      slug: 'park-trail',
      name: 'Park Trail',
      length_km: 5.2,
      thumbnail_key: 'thumb.jpg',
      standalone: true,
      memberOf: 'parks-network',
      hasMarkdown: true,
      surface: 'asphalt',
      path_type: 'mup',
      vibe: 'scenic',
    });

    const ref = toMemberRef(page);

    expect(ref.slug).toBe('park-trail');
    expect(ref.name).toBe('Park Trail');
    expect(ref.length_km).toBe(5.2);
    expect(ref.thumbnail_key).toBe('thumb.jpg');
    expect(ref.standalone).toBe(true);
    expect(ref.memberOf).toBe('parks-network');
    expect(ref.hasMarkdown).toBe(true);
    expect(ref.surface).toBe('asphalt');
    expect(ref.path_type).toBe('mup');
    expect(ref.vibe).toBe('scenic');
  });

  it('derives entryType from the first ymlEntry', () => {
    const page = fakePage({
      ymlEntries: [
        { slug: 'x', type: 'destination', name: 'x' } as any,
        { slug: 'y', type: 'connector', name: 'y' } as any,
      ],
    });
    expect(toMemberRef(page).entryType).toBe('destination');
  });

  it('returns undefined entryType when ymlEntries is empty', () => {
    const page = fakePage({ ymlEntries: [] });
    expect(toMemberRef(page).entryType).toBeUndefined();
  });

  it('narrows overlapping_relations to {id, name, route} only', () => {
    const page = fakePage({
      overlapping_relations: [
        {
          id: 42,
          name: 'Gatineau Park Trail',
          route: 'foot',
          operator: 'NCC',
          ref: 'GP-7',
          network: 'ncn',
          wikipedia: 'en:Foo',
          website: 'https://example.com',
        },
      ],
    });

    const ref = toMemberRef(page);
    expect(ref.overlappingRelations).toEqual([
      { id: 42, name: 'Gatineau Park Trail', route: 'foot' },
    ]);
  });

  it('leaves overlappingRelations undefined when source is undefined', () => {
    const page = fakePage();
    expect(toMemberRef(page).overlappingRelations).toBeUndefined();
  });
});

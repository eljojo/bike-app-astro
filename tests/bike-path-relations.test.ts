import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PathLike } from 'node:fs';

// Mock filesystem — computeBikePathRelations reads route frontmatter from disk
const mockExistsSync = vi.fn<(p: PathLike) => boolean>().mockReturnValue(false);
const mockReadFileSync = vi.fn<(p: PathLike, encoding?: string) => string>().mockReturnValue('');
const mockReaddirSync = vi.fn().mockReturnValue([]);

vi.mock('node:fs', () => ({
  default: {
    existsSync: (...args: unknown[]) => mockExistsSync(args[0] as PathLike),
    readFileSync: (...args: unknown[]) => mockReadFileSync(args[0] as PathLike, args[1] as string),
    readdirSync: (...args: unknown[]) => mockReaddirSync(args[0] as PathLike),
  },
}));

vi.mock('../src/lib/config/config.server', () => ({
  cityDir: '/tmp/fake-city',
}));

vi.mock('../src/lib/config/city-config', () => ({
  getCityConfig: () => ({
    locales: ['en-CA', 'fr-CA'],
    operator_aliases: {},
  }),
}));

import { computeBikePathRelations } from '../src/lib/bike-paths/bike-path-relations.server';
import type { SluggedBikePathYml } from '../src/lib/bike-paths/bikepaths-yml.server';
import { haversineM } from '../src/lib/geo/proximity';

/** Generate a line of points, each offset by stepLat/stepLng from the previous. */
function lineOfPoints(startLat: number, startLng: number, count: number, stepLat = 0.001, stepLng = 0.001) {
  return Array.from({ length: count }, (_, i) => ({
    lat: startLat + i * stepLat,
    lng: startLng + i * stepLng,
  }));
}

/** Create a minimal SluggedBikePathYml entry. */
function makeEntry(overrides: Partial<SluggedBikePathYml> & { slug: string; name: string }): SluggedBikePathYml {
  return {
    highway: 'cycleway',
    ...overrides,
  };
}

/**
 * Configure fs mocks to return published route metadata for given routes.
 * Each route entry: { slug, name, distance_km }.
 */
function mockRouteMetadata(routes: Array<{ slug: string; name: string; distance_km: number }>) {
  const routeSlugs = routes.map(r => r.slug);
  const routeMap = new Map(routes.map(r => [r.slug, r]));

  mockExistsSync.mockImplementation((p: PathLike) => {
    const s = String(p);
    if (s === '/tmp/fake-city/routes') return true;
    for (const slug of routeSlugs) {
      if (s === `/tmp/fake-city/routes/${slug}/index.md`) return true;
    }
    return false;
  });

  mockReaddirSync.mockImplementation((p: PathLike) => {
    if (String(p) === '/tmp/fake-city/routes') return routeSlugs;
    return [];
  });

  mockReadFileSync.mockImplementation((p: PathLike) => {
    const s = String(p);
    for (const [slug, route] of routeMap) {
      if (s.includes(`${slug}/index.md`)) {
        return `---\nname: ${route.name}\ndistance_km: ${route.distance_km}\nstatus: published\n---\n`;
      }
    }
    return '';
  });
}

beforeEach(() => {
  mockExistsSync.mockReset().mockReturnValue(false);
  mockReadFileSync.mockReset().mockReturnValue('');
  mockReaddirSync.mockReset().mockReturnValue([]);
});

describe('computeBikePathRelations', () => {
  describe('route overlap detection', () => {
    it('detects overlap when route metadata is available and >= 5% of route points overlap', () => {
      mockRouteMetadata([{ slug: 'test-route', name: 'Test Route', distance_km: 15 }]);

      const pathEntry = makeEntry({ slug: 'canal-path', name: 'Canal Path', osm_relations: [200] });
      const pathPoints = lineOfPoints(45.0, -75.7, 20, 0.001, 0);

      // Route: all 20 points identical to path points (100% overlap, well above 5%)
      const routePoints = lineOfPoints(45.0, -75.7, 20, 0.001, 0);

      const { relations, routeOverlaps } = computeBikePathRelations(
        [pathEntry],
        { '200': pathPoints },
        { 'test-route': routePoints },
        [],
        [],
      );

      expect(routeOverlaps['canal-path'].count).toBe(1);
      expect(relations['canal-path'].overlappingRoutes).toHaveLength(1);
      expect(relations['canal-path'].overlappingRoutes[0]).toMatchObject({
        slug: 'test-route',
        name: 'Test Route',
        distance_km: 15,
      });
    });

    it('excludes routes without published frontmatter from overlap results', () => {
      // fs mock returns false for everything — no route metadata available
      const pathEntry = makeEntry({ slug: 'river-path', name: 'River Path', osm_relations: [100] });
      const pathPoints = lineOfPoints(45.0, -75.7, 20, 0.001, 0);
      const routePoints = lineOfPoints(45.0, -75.7, 20, 0.001, 0);

      const { relations, routeOverlaps } = computeBikePathRelations(
        [pathEntry],
        { '100': pathPoints },
        { 'ghost-route': routePoints },
        [],
        [],
      );

      // Spatial overlap exists but route has no published metadata
      expect(routeOverlaps['river-path'].count).toBe(0);
      expect(relations['river-path'].overlappingRoutes).toHaveLength(0);
    });

    it('does not detect overlap when route is far from path', () => {
      mockRouteMetadata([{ slug: 'far-route', name: 'Far Route', distance_km: 25 }]);

      const pathEntry = makeEntry({ slug: 'north-path', name: 'North Path', osm_relations: [300] });
      const pathPoints = lineOfPoints(45.0, -75.7, 20, 0.001, 0);

      // Route: 5 degrees away
      const routePoints = lineOfPoints(50.0, -70.0, 20, 0.001, 0);

      const { routeOverlaps } = computeBikePathRelations(
        [pathEntry],
        { '300': pathPoints },
        { 'far-route': routePoints },
        [],
        [],
      );

      expect(routeOverlaps['north-path'].count).toBe(0);
    });

    it('requires at least 5% of route points near path for overlap', () => {
      mockRouteMetadata([{ slug: 'partial-route', name: 'Partial Route', distance_km: 20 }]);

      const pathEntry = makeEntry({ slug: 'short-path', name: 'Short Path', osm_relations: [400] });
      const pathPoints = lineOfPoints(45.0, -75.7, 20, 0.001, 0);

      // Route: 100 points, only 1 near the path (1% < 5% threshold)
      const routePoints = [
        { lat: 45.0, lng: -75.7 },
        ...lineOfPoints(50.0, -70.0, 99, 0.001, 0),
      ];

      const { routeOverlaps } = computeBikePathRelations(
        [pathEntry],
        { '400': pathPoints },
        { 'partial-route': routePoints },
        [],
        [],
      );

      expect(routeOverlaps['short-path'].count).toBe(0);
    });
  });

  describe('nearby places', () => {
    it('finds places within 300m of path points', () => {
      const pathEntry = makeEntry({ slug: 'park-path', name: 'Park Path', osm_relations: [500] });
      const pathPoints = lineOfPoints(45.0, -75.7, 10, 0.001, 0);

      // Place right on the path (0m away)
      const places = [
        { name: 'Riverbank Cafe', category: 'cafe', lat: 45.0, lng: -75.7 },
      ];

      const { relations } = computeBikePathRelations(
        [pathEntry],
        { '500': pathPoints },
        {},
        places,
        [],
      );

      expect(relations['park-path'].nearbyPlaces).toHaveLength(1);
      expect(relations['park-path'].nearbyPlaces[0].name).toBe('Riverbank Cafe');
      expect(relations['park-path'].nearbyPlaces[0].distance_m).toBe(0);
    });

    it('excludes places beyond 300m from path', () => {
      const pathEntry = makeEntry({ slug: 'long-path', name: 'Long Path', osm_relations: [501] });
      const pathPoints = lineOfPoints(45.0, -75.7, 10, 0.001, 0);

      // Place ~5.5km away — well beyond 300m threshold
      const places = [
        { name: 'Far Away Shop', category: 'shop', lat: 45.05, lng: -75.7 },
      ];

      const { relations } = computeBikePathRelations(
        [pathEntry],
        { '501': pathPoints },
        {},
        places,
        [],
      );

      expect(relations['long-path'].nearbyPlaces).toHaveLength(0);
    });

    it('sorts nearby places by distance', () => {
      const pathEntry = makeEntry({ slug: 'sorted-path', name: 'Sorted Path', osm_relations: [502] });
      const pathPoints = lineOfPoints(45.0, -75.7, 10, 0.001, 0);

      // Two places at different distances from path, both within 300m
      // At lat 45, 0.001 lng ~ 78m, so 0.0025 ~ 195m
      const places = [
        { name: 'Far Bench', category: 'bench', lat: 45.0, lng: -75.6975 },
        { name: 'Close Cafe', category: 'cafe', lat: 45.0, lng: -75.7 },
      ];

      const { relations } = computeBikePathRelations(
        [pathEntry],
        { '502': pathPoints },
        {},
        places,
        [],
      );

      expect(relations['sorted-path'].nearbyPlaces).toHaveLength(2);
      expect(relations['sorted-path'].nearbyPlaces[0].name).toBe('Close Cafe');
      expect(relations['sorted-path'].nearbyPlaces[1].name).toBe('Far Bench');
      expect(relations['sorted-path'].nearbyPlaces[0].distance_m).toBeLessThan(
        relations['sorted-path'].nearbyPlaces[1].distance_m,
      );
    });

    it('excludes unpublished places', () => {
      const pathEntry = makeEntry({ slug: 'filter-path', name: 'Filter Path', osm_relations: [503] });
      const pathPoints = lineOfPoints(45.0, -75.7, 10, 0.001, 0);

      const places = [
        { name: 'Draft Place', category: 'cafe', lat: 45.0, lng: -75.7, status: 'draft' },
        { name: 'Published Place', category: 'bench', lat: 45.0, lng: -75.7, status: 'published' },
      ];

      const { relations } = computeBikePathRelations(
        [pathEntry],
        { '503': pathPoints },
        {},
        places,
        [],
      );

      expect(relations['filter-path'].nearbyPlaces).toHaveLength(1);
      expect(relations['filter-path'].nearbyPlaces[0].name).toBe('Published Place');
    });
  });

  describe('connected paths', () => {
    it('detects paths with endpoints within 200m of each other', () => {
      const pathA = makeEntry({ slug: 'path-a', name: 'Path A', osm_relations: [600] });
      const pointsA = lineOfPoints(45.0, -75.7, 10, 0.001, 0);

      // Path B starts exactly where path A ends
      const lastPointA = pointsA[pointsA.length - 1];
      const pathB = makeEntry({ slug: 'path-b', name: 'Path B', osm_relations: [601] });
      const pointsB = lineOfPoints(lastPointA.lat, lastPointA.lng, 10, 0.001, 0);

      const { relations } = computeBikePathRelations(
        [pathA, pathB],
        { '600': pointsA, '601': pointsB },
        {},
        [],
        [],
      );

      expect(relations['path-a'].connectedPaths).toHaveLength(1);
      expect(relations['path-a'].connectedPaths[0].slug).toBe('path-b');

      expect(relations['path-b'].connectedPaths).toHaveLength(1);
      expect(relations['path-b'].connectedPaths[0].slug).toBe('path-a');
    });

    it('does not connect paths with endpoints > 200m apart', () => {
      const pathA = makeEntry({ slug: 'iso-a', name: 'Isolated A', osm_relations: [602] });
      const pointsA = lineOfPoints(45.0, -75.7, 10, 0.001, 0);

      // Path B starts 5 degrees away
      const pathB = makeEntry({ slug: 'iso-b', name: 'Isolated B', osm_relations: [603] });
      const pointsB = lineOfPoints(50.0, -70.0, 10, 0.001, 0);

      const { relations } = computeBikePathRelations(
        [pathA, pathB],
        { '602': pointsA, '603': pointsB },
        {},
        [],
        [],
      );

      expect(relations['iso-a'].connectedPaths).toHaveLength(0);
      expect(relations['iso-b'].connectedPaths).toHaveLength(0);
    });

    it('connects when start of one path is near end of another', () => {
      const pathA = makeEntry({ slug: 'chain-a', name: 'Chain A', osm_relations: [604] });
      const pointsA = lineOfPoints(45.0, -75.7, 10, 0.001, 0);

      // Path B starts ~44m from path A's last point (within 200m)
      const lastA = pointsA[pointsA.length - 1];
      const pathB = makeEntry({ slug: 'chain-b', name: 'Chain B', osm_relations: [605] });
      const pointsB = lineOfPoints(lastA.lat + 0.0004, lastA.lng, 10, 0.001, 0);

      // Sanity check: distance is within 200m
      const dist = haversineM(lastA.lat, lastA.lng, pointsB[0].lat, pointsB[0].lng);
      expect(dist).toBeLessThan(200);

      const { relations } = computeBikePathRelations(
        [pathA, pathB],
        { '604': pointsA, '605': pointsB },
        {},
        [],
        [],
      );

      expect(relations['chain-a'].connectedPaths).toHaveLength(1);
      expect(relations['chain-a'].connectedPaths[0].slug).toBe('chain-b');
    });
  });

  describe('nearby photos', () => {
    it('finds photos within 300m of path points', () => {
      const pathEntry = makeEntry({ slug: 'photo-path', name: 'Photo Path', osm_relations: [700] });
      const pathPoints = lineOfPoints(45.0, -75.7, 10, 0.001, 0);

      const photos = [
        { key: 'photo-1', lat: 45.0, lng: -75.7, routeSlug: 'some-route', caption: 'Nice view' },
      ];

      const { relations } = computeBikePathRelations(
        [pathEntry],
        { '700': pathPoints },
        {},
        [],
        photos,
      );

      expect(relations['photo-path'].nearbyPhotos).toHaveLength(1);
      expect(relations['photo-path'].nearbyPhotos[0].key).toBe('photo-1');
      expect(relations['photo-path'].nearbyPhotos[0].caption).toBe('Nice view');
    });

    it('excludes photos beyond 300m from path', () => {
      const pathEntry = makeEntry({ slug: 'no-photo-path', name: 'No Photo Path', osm_relations: [701] });
      const pathPoints = lineOfPoints(45.0, -75.7, 10, 0.001, 0);

      // Photo ~5.5km away
      const photos = [
        { key: 'far-photo', lat: 45.05, lng: -75.7, routeSlug: 'route-x' },
      ];

      const { relations } = computeBikePathRelations(
        [pathEntry],
        { '701': pathPoints },
        {},
        [],
        photos,
      );

      expect(relations['no-photo-path'].nearbyPhotos).toHaveLength(0);
    });

    it('caps nearby photos at 20', () => {
      const pathEntry = makeEntry({ slug: 'many-photos', name: 'Many Photos Path', osm_relations: [702] });
      // A dense path with many points close together
      const pathPoints = lineOfPoints(45.0, -75.7, 50, 0.0001, 0);

      // 30 photos, all right on the path
      const photos = Array.from({ length: 30 }, (_, i) => ({
        key: `photo-${i}`,
        lat: 45.0 + i * 0.0001,
        lng: -75.7,
        routeSlug: 'route-y',
      }));

      const { relations } = computeBikePathRelations(
        [pathEntry],
        { '702': pathPoints },
        {},
        [],
        photos,
      );

      expect(relations['many-photos'].nearbyPhotos).toHaveLength(20);
    });
  });

  describe('nearby paths', () => {
    it('detects paths within 2km of each other', () => {
      const pathA = makeEntry({ slug: 'near-a', name: 'Near A', osm_relations: [800] });
      const pointsA = lineOfPoints(45.0, -75.7, 10, 0.001, 0);

      // Path B: parallel, ~470m east (within 2km)
      const pathB = makeEntry({ slug: 'near-b', name: 'Near B', osm_relations: [801] });
      const pointsB = lineOfPoints(45.0, -75.694, 10, 0.001, 0);

      // Sanity check distance
      const dist = haversineM(pointsA[0].lat, pointsA[0].lng, pointsB[0].lat, pointsB[0].lng);
      expect(dist).toBeLessThan(2000);

      const { relations } = computeBikePathRelations(
        [pathA, pathB],
        { '800': pointsA, '801': pointsB },
        {},
        [],
        [],
      );

      expect(relations['near-a'].nearbyPaths.map(p => p.slug)).toContain('near-b');
      expect(relations['near-b'].nearbyPaths.map(p => p.slug)).toContain('near-a');
    });

    it('does not list paths > 2km apart as nearby', () => {
      const pathA = makeEntry({ slug: 'far-a', name: 'Far A', osm_relations: [802] });
      const pointsA = lineOfPoints(45.0, -75.7, 10, 0.001, 0);

      // Path B: ~55km away
      const pathB = makeEntry({ slug: 'far-b', name: 'Far B', osm_relations: [803] });
      const pointsB = lineOfPoints(45.5, -75.7, 10, 0.001, 0);

      // Sanity check distance
      const dist = haversineM(pointsA[0].lat, pointsA[0].lng, pointsB[0].lat, pointsB[0].lng);
      expect(dist).toBeGreaterThan(2000);

      const { relations } = computeBikePathRelations(
        [pathA, pathB],
        { '802': pointsA, '803': pointsB },
        {},
        [],
        [],
      );

      expect(relations['far-a'].nearbyPaths).toHaveLength(0);
      expect(relations['far-b'].nearbyPaths).toHaveLength(0);
    });
  });

  describe('hard-excluded entries', () => {
    it('skips hard-excluded entries (no relations computed)', () => {
      const excluded = makeEntry({ slug: 'footway', name: 'Some Footway', highway: 'footway', osm_relations: [900] });
      const valid = makeEntry({ slug: 'cycleway', name: 'Good Cycleway', highway: 'cycleway', osm_relations: [901] });

      const { relations } = computeBikePathRelations(
        [excluded, valid],
        { '900': lineOfPoints(45.0, -75.7, 10), '901': lineOfPoints(45.0, -75.7, 10) },
        {},
        [],
        [],
      );

      expect(relations['footway']).toBeUndefined();
      expect(relations['cycleway']).toBeDefined();
    });
  });

  describe('routeToPaths reverse map', () => {
    it('builds reverse mapping from routes to paths', () => {
      mockRouteMetadata([{ slug: 'mapped-route', name: 'Mapped Route', distance_km: 10 }]);

      const pathEntry = makeEntry({ slug: 'reverse-path', name: 'Reverse Path', osm_relations: [950] });
      const pathPoints = lineOfPoints(45.0, -75.7, 20, 0.001, 0);
      const routePoints = lineOfPoints(45.0, -75.7, 20, 0.001, 0);

      const { routeToPaths } = computeBikePathRelations(
        [pathEntry],
        { '950': pathPoints },
        { 'mapped-route': routePoints },
        [],
        [],
      );

      expect(routeToPaths['mapped-route']).toHaveLength(1);
      expect(routeToPaths['mapped-route'][0].slug).toBe('reverse-path');
      expect(routeToPaths['mapped-route'][0].name).toBe('Reverse Path');
    });
  });

  describe('entries with no points', () => {
    it('produces empty relations for entries with no geometry', () => {
      const pathEntry = makeEntry({ slug: 'empty-path', name: 'Empty Path', osm_relations: [999] });

      const { relations, routeOverlaps } = computeBikePathRelations(
        [pathEntry],
        {},
        {},
        [],
        [],
      );

      expect(relations['empty-path']).toEqual({
        overlappingRoutes: [],
        nearbyPhotos: [],
        nearbyPlaces: [],
        nearbyPaths: [],
        connectedPaths: [],
      });
      expect(routeOverlaps['empty-path'].count).toBe(0);
    });
  });

  describe('point source resolution', () => {
    it('uses osm_relations geoCoords as primary point source', () => {
      const pathEntry = makeEntry({
        slug: 'rel-path',
        name: 'Relation Path',
        osm_relations: [111],
        anchors: [{ lat: 50.0, lng: -70.0 }],
      });

      // Photo near the relation coords (not the anchor)
      const photo = { key: 'rel-photo', lat: 45.0, lng: -75.7, routeSlug: 'r1' };

      const { relations } = computeBikePathRelations(
        [pathEntry],
        { '111': lineOfPoints(45.0, -75.7, 5) },
        {},
        [],
        [photo],
      );

      // Photo found because relation coords (45.0, -75.7) are used, not anchors (50.0, -70.0)
      expect(relations['rel-path'].nearbyPhotos).toHaveLength(1);
    });

    it('falls back to osm_names geoCoords when no relation coords', () => {
      const pathEntry = makeEntry({
        slug: 'name-path',
        name: 'Name Path',
        osm_relations: [],
        osm_names: ['Some Street'],
      });

      const photo = { key: 'name-photo', lat: 45.0, lng: -75.7, routeSlug: 'r2' };

      const { relations } = computeBikePathRelations(
        [pathEntry],
        { 'name-name-path': lineOfPoints(45.0, -75.7, 5) },
        {},
        [],
        [photo],
      );

      expect(relations['name-path'].nearbyPhotos).toHaveLength(1);
    });

    it('falls back to anchors when no GeoJSON data', () => {
      const pathEntry: SluggedBikePathYml = {
        slug: 'anchor-path',
        name: 'Anchor Path',
        anchors: [{ lat: 45.0, lng: -75.7 }, { lat: 45.001, lng: -75.7 }],
      };

      const photo = { key: 'anchor-photo', lat: 45.0, lng: -75.7, routeSlug: 'r3' };

      const { relations } = computeBikePathRelations(
        [pathEntry],
        {},
        {},
        [],
        [photo],
      );

      expect(relations['anchor-path'].nearbyPhotos).toHaveLength(1);
    });
  });
});

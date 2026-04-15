/**
 * Unit tests for the paths index view-model builder.
 *
 * Uses synthetic BikePathPage / MemberRef fixtures so each concern can be
 * exercised in isolation (partition, category assembly, geoId exclusion).
 * The real-YML integration is covered by index-categories.test.ts.
 */
import { describe, it, expect } from 'vitest';
import type { BikePathPage, MemberRef } from '../../src/lib/bike-paths/bike-path-entries.server';
import type { Translator } from '../../src/lib/bike-paths/bike-path-facts';
import {
  partitionNetworkMembers,
  classifyIndependentPaths,
  buildNetworkInfo,
  assembleCategories,
  buildNetworkGeoIds,
  buildPathsIndexData,
} from '../../src/lib/bike-paths/paths-index-data.server';

// ── Fixtures ────────────────────────────────────────────────────────

/** Identity translator — returns the key so assertions can match by key. */
const tStub: Translator = (key) => key;

function makePage(overrides: Partial<BikePathPage> & { slug: string; name: string }): BikePathPage {
  return {
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
    entryType: 'destination',
    translations: {},
    ...overrides,
  } as BikePathPage;
}

function makeMemberRef(overrides: Partial<MemberRef> & { slug: string; name: string }): MemberRef {
  return {
    standalone: true,
    hasMarkdown: false,
    ...overrides,
  };
}

// ── partitionNetworkMembers ─────────────────────────────────────────

describe('partitionNetworkMembers', () => {
  it('separates long-distance members from local ones', () => {
    const net = makePage({
      slug: 'net-a',
      name: 'Net A',
      memberRefs: [
        makeMemberRef({ slug: 'a', name: 'A', length_km: 5 }),
        makeMemberRef({ slug: 'b', name: 'B', length_km: 120, entryType: 'long-distance' }),
        makeMemberRef({ slug: 'c', name: 'C', length_km: 2 }),
      ],
    });

    const { localRefs, longDistanceMemberRefs } = partitionNetworkMembers(net);

    expect(localRefs.map(m => m.slug)).toEqual(['a', 'c']);
    expect(longDistanceMemberRefs.map(m => m.slug)).toEqual(['b']);
  });

  it('drops members shorter than 0.5 km entirely', () => {
    const net = makePage({
      slug: 'net',
      name: 'Net',
      memberRefs: [
        makeMemberRef({ slug: 'keep', name: 'Keep', length_km: 0.5 }),
        makeMemberRef({ slug: 'drop', name: 'Drop', length_km: 0.3 }),
        makeMemberRef({ slug: 'unknown', name: 'Unknown' }), // length_km undefined → kept
      ],
    });

    const { localRefs } = partitionNetworkMembers(net);
    expect(localRefs.map(m => m.slug)).toEqual(['keep', 'unknown']);
  });

  it('is a pure function: calling twice produces identical output', () => {
    const net = makePage({
      slug: 'net',
      name: 'Net',
      memberRefs: [
        makeMemberRef({ slug: 'ld', name: 'LD', entryType: 'long-distance', length_km: 50 }),
      ],
    });
    const a = partitionNetworkMembers(net);
    const b = partitionNetworkMembers(net);
    expect(a.longDistanceMemberRefs.map(m => m.slug))
      .toEqual(b.longDistanceMemberRefs.map(m => m.slug));
  });
});

// ── classifyIndependentPaths ────────────────────────────────────────

describe('classifyIndependentPaths', () => {
  it('buckets by classifyIndependentPath result', () => {
    const pages = [
      makePage({ slug: 'mup', name: 'MUP', path_type: 'mup', length_km: 5 }),
      makePage({ slug: 'trail', name: 'Trail', path_type: 'trail', length_km: 10 }),
      makePage({ slug: 'mtb', name: 'MTB', path_type: 'mtb-trail', length_km: 3 }),
      makePage({ slug: 'ld', name: 'LD', entryType: 'long-distance', length_km: 100 }),
      makePage({ slug: 'other', name: 'Other', path_type: 'bike-lane', length_km: 2 }),
    ];

    const { byCategory, uncategorized } = classifyIndependentPaths(pages);

    expect(byCategory.pathways?.map(p => p.slug)).toEqual(['mup']);
    expect(byCategory.mtb?.map(p => p.slug)).toEqual(['mtb']);
    expect(byCategory.trails?.map(p => p.slug)).toEqual(['trail', 'ld']);
    expect(uncategorized.map(p => p.slug)).toEqual(['other']);
  });
});

// ── buildNetworkInfo ────────────────────────────────────────────────

describe('buildNetworkInfo', () => {
  it('recomputes length from kept local members', () => {
    const net = makePage({
      slug: 'net',
      name: 'Net',
      length_km: 100, // Pre-extraction length
    });
    const localRefs: MemberRef[] = [
      makeMemberRef({ slug: 'a', name: 'A', length_km: 5, hasMarkdown: true }),
      makeMemberRef({ slug: 'b', name: 'B', length_km: 3, hasMarkdown: true }),
    ];

    const info = buildNetworkInfo(net, localRefs, undefined);
    expect(info.length_km).toBe(8); // sum of localRefs, not the pre-extraction 100
  });

  it('falls back to net.length_km when all members are zero-length', () => {
    const net = makePage({ slug: 'net', name: 'Net', length_km: 42 });
    const info = buildNetworkInfo(net, [], undefined);
    expect(info.length_km).toBe(42);
  });

  it('precomputes URLs for tier members', () => {
    const net = makePage({ slug: 'net', name: 'Net' });
    const localRefs: MemberRef[] = [
      makeMemberRef({ slug: 'a', name: 'A', length_km: 5, hasMarkdown: true, standalone: true }),
      makeMemberRef({ slug: 'b', name: 'B', length_km: 4, hasMarkdown: true, standalone: false }),
    ];
    const info = buildNetworkInfo(net, localRefs, undefined);
    const byName = Object.fromEntries(info.tier1.map(m => [m.name, m]));
    expect(byName['A'].url).toContain('/bike-paths/net/a');
    expect(byName['B'].url).toBeUndefined();
  });
});

// ── assembleCategories ──────────────────────────────────────────────

describe('assembleCategories', () => {
  const emptyCategoryMap = {
    pathways: [],
    mtb: [],
    trails: [],
    bikeways: [],
  };

  it('orders tabs: pathways → mtb → trails → bikeways', () => {
    const { categories } = assembleCategories({
      categoryMap: {
        bikeways: [{ slug: 'b', name: 'B', url: '/bike-paths/b', tier1: [], tier2: [] }],
        pathways: [{ slug: 'p', name: 'P', url: '/bike-paths/p', tier1: [], tier2: [] }],
        mtb: [{ slug: 'm', name: 'M', url: '/bike-paths/m', tier1: [], tier2: [] }],
        trails: [],
      },
      independentByCategory: {},
      initialUncategorized: [],
      longDistanceMemberRefs: [],
      pageBySlug: new Map(),
      locale: undefined,
      t: tStub,
    });

    expect(categories.map(c => c.key)).toEqual(['pathways', 'mtb', 'bikeways']);
  });

  it('merges extracted long-distance members into the Trails tab', () => {
    const ldMemberPage = makePage({
      slug: 'sentier-x',
      name: 'Sentier X',
      length_km: 80,
      entryType: 'long-distance',
    });
    const pageBySlug = new Map([[ldMemberPage.slug, ldMemberPage]]);

    const { categories } = assembleCategories({
      categoryMap: emptyCategoryMap,
      independentByCategory: {},
      initialUncategorized: [],
      longDistanceMemberRefs: [
        makeMemberRef({ slug: 'sentier-x', name: 'Sentier X', entryType: 'long-distance', length_km: 80 }),
      ],
      pageBySlug,
      locale: undefined,
      t: tStub,
    });

    expect(categories.map(c => c.key)).toEqual(['trails']);
    expect(categories[0].standalonePaths.map(sp => sp.slug)).toEqual(['sentier-x']);
  });

  it('does not duplicate a trail already present as an independent', () => {
    const trail = makePage({
      slug: 'prescott-russell',
      name: 'Prescott-Russell',
      length_km: 60,
      path_type: 'trail',
    });
    const pageBySlug = new Map([[trail.slug, trail]]);

    const { categories } = assembleCategories({
      categoryMap: emptyCategoryMap,
      independentByCategory: { trails: [trail] },
      initialUncategorized: [],
      longDistanceMemberRefs: [
        makeMemberRef({ slug: 'prescott-russell', name: 'Prescott-Russell', length_km: 60 }),
      ],
      pageBySlug,
      locale: undefined,
      t: tStub,
    });

    const trailsTab = categories.find(c => c.key === 'trails')!;
    expect(trailsTab.standalonePaths.map(sp => sp.slug)).toEqual(['prescott-russell']);
  });

  it('demotes short anonymous MUPs from Pathways into the uncategorized bucket', () => {
    const longMup = makePage({ slug: 'long', name: 'Long', path_type: 'mup', length_km: 5 });
    const shortMup = makePage({ slug: 'short', name: 'Short', path_type: 'mup', length_km: 1.5 });
    const markdownMup = makePage({
      slug: 'with-markdown',
      name: 'With Markdown',
      path_type: 'mup',
      length_km: 1.2, // short but has markdown → featured
      hasMarkdown: true,
    });

    const { categories, uncategorized } = assembleCategories({
      categoryMap: {
        ...emptyCategoryMap,
        pathways: [{ slug: 'net', name: 'Net', url: '/bike-paths/net', tier1: [], tier2: [] }],
      },
      independentByCategory: { pathways: [longMup, shortMup, markdownMup] },
      initialUncategorized: [],
      longDistanceMemberRefs: [],
      pageBySlug: new Map(),
      locale: undefined,
      t: tStub,
    });

    const pathwaysTab = categories.find(c => c.key === 'pathways')!;
    expect(pathwaysTab.standalonePaths.map(sp => sp.slug).sort()).toEqual(['long', 'with-markdown']);
    expect(uncategorized.map(p => p.slug)).toEqual(['short']);
  });

  it('creates a new Pathways tab from independents when no network exists', () => {
    const longMup = makePage({ slug: 'long', name: 'Long', path_type: 'mup', length_km: 5 });

    const { categories } = assembleCategories({
      categoryMap: emptyCategoryMap,
      independentByCategory: { pathways: [longMup] },
      initialUncategorized: [],
      longDistanceMemberRefs: [],
      pageBySlug: new Map(),
      locale: undefined,
      t: tStub,
    });

    const pathwaysTab = categories.find(c => c.key === 'pathways');
    expect(pathwaysTab).toBeDefined();
    expect(pathwaysTab!.networks).toEqual([]);
    expect(pathwaysTab!.standalonePaths.map(sp => sp.slug)).toEqual(['long']);
  });
});

// ── buildNetworkGeoIds (LD exclusion invariant) ─────────────────────

describe('buildNetworkGeoIds', () => {
  it('excludes extracted long-distance members from their parent network geoIds', () => {
    const ldMemberPage = makePage({
      slug: 'ld-member',
      name: 'LD Member',
      geoFiles: ['ld-123.geojson'],
    });
    const localMemberPage = makePage({
      slug: 'local-member',
      name: 'Local Member',
      geoFiles: ['local-456.geojson'],
    });
    const net = makePage({
      slug: 'net',
      name: 'Net',
      geoFiles: ['net-0.geojson', 'ld-123.geojson', 'local-456.geojson'],
      memberRefs: [
        makeMemberRef({ slug: 'ld-member', name: 'LD Member', entryType: 'long-distance', length_km: 50 }),
        makeMemberRef({ slug: 'local-member', name: 'Local Member', length_km: 3 }),
      ],
    });
    const pageBySlug = new Map([
      [net.slug, net],
      [ldMemberPage.slug, ldMemberPage],
      [localMemberPage.slug, localMemberPage],
    ]);
    const extractedLdSlugs = new Set(['ld-member']);

    const result = buildNetworkGeoIds([net], pageBySlug, extractedLdSlugs);

    // ld-123 is excluded, local-456 is included once (the net's own copy is filtered,
    // then local-member's page re-adds it).
    expect(result.net).toContain('net-0');
    expect(result.net).toContain('local-456');
    expect(result.net).not.toContain('ld-123');
  });
});

// ── buildPathsIndexData (end-to-end smoke) ──────────────────────────

describe('buildPathsIndexData', () => {
  it('produces a non-empty view model for a small dataset', () => {
    const pages: BikePathPage[] = [
      makePage({
        slug: 'net',
        name: 'Sample Network',
        length_km: 12,
        geoFiles: ['net.geojson'],
        memberRefs: [
          makeMemberRef({ slug: 'net-a', name: 'Segment A', length_km: 5, hasMarkdown: true }),
          makeMemberRef({ slug: 'net-b', name: 'Segment B', length_km: 7, hasMarkdown: true }),
        ],
      }),
      makePage({
        slug: 'net-a',
        name: 'Segment A',
        memberOf: 'net',
        length_km: 5,
        geoFiles: ['net-a.geojson'],
      }),
      makePage({
        slug: 'net-b',
        name: 'Segment B',
        memberOf: 'net',
        length_km: 7,
        geoFiles: ['net-b.geojson'],
      }),
      makePage({
        slug: 'standalone-mup',
        name: 'Standalone MUP',
        path_type: 'mup',
        length_km: 6,
        surface: 'asphalt',
      }),
    ];

    const data = buildPathsIndexData({ allPages: pages, locale: undefined, t: tStub });

    expect(data.pathCount).toBeGreaterThan(0);
    expect(data.categories.length).toBeGreaterThan(0);
    expect(Object.keys(data.map.networkGeoIds)).toContain('net');
    expect(Object.keys(data.map.slugInfo)).toContain('standalone-mup');
  });
});

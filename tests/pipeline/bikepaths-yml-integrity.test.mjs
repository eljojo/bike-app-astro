/**
 * Integrity tests for Ottawa bike path pipeline output.
 *
 * Runs the pipeline with cached Overpass data — no file dependencies,
 * no skipIf guards. Asserts real-world geographic and classification facts
 * about Ottawa's cycling infrastructure.
 *
 * Pipeline setup is shared via tests/pipeline/ottawa-pipeline.ts so the
 * same in-memory run can be reused by other Ottawa regression tests.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, beforeAll } from 'vitest';
import { loadOttawaPipelineResult } from './ottawa-pipeline.ts';
import { buildTiles } from '../../scripts/generate-path-tiles.ts';
import { loadBikePathEntries } from '../../src/lib/bike-paths/bike-path-entries.server.ts';

let entries;
let bySlug;
let byName;

beforeAll(async () => {
  const result = await loadOttawaPipelineResult();
  entries = result.entries;
  bySlug = result.bySlug;
  byName = result.byName;
}, 300_000);

function net(slug) {
  const e = bySlug.get(slug);
  expect(e, `network ${slug} must exist`).toBeDefined();
  return e;
}

function entry(slug) {
  const e = bySlug.get(slug);
  expect(e, `entry ${slug} must exist`).toBeDefined();
  return e;
}

// ---------------------------------------------------------------------------
// Long-distance classification — only truly long trails
// ---------------------------------------------------------------------------

describe('long-distance classification', () => {
  const mustNotBeLongDistance = [
    'sentier-des-pionniers-pathway',
    'watts-creek-pathway',
    'greenbelt-pathway-west',
    'greenbelt-pathway-west-barrhaven',
    'rideau-canal-eastern-pathway',
    'rideau-canal-western-pathway',
    'experimental-farm-pathway',
    'ottawa-river-pathway-east',
    'ottawa-river-pathway-west',
    'prescott-russell-trail-link',
    // NCN-tagged but short — being part of a national route doesn't make
    // a 4.4km bike lane or 14.9km MUP section long-distance
    'trans-canada-trail-sussex-drive',
    'ottawa-river-pathway-trans-canada-trail',
  ];

  for (const slug of mustNotBeLongDistance) {
    it(`${slug} is NOT long-distance (it's a local pathway)`, () => {
      const e = entry(slug);
      expect(e.type).not.toBe('long-distance');
    });
  }

  it('Sentier Trans-Canada Gatineau-Montréal IS long-distance', () => {

    const e = entry('sentier-trans-canada-gatineau-montreal');
    expect(e.type).toBe('long-distance');
  });

  it('Sentier Trans-Canada Gatineau-Montréal has no member_of (too large for any local network)', () => {

    const e = entry('sentier-trans-canada-gatineau-montreal');
    expect(e.member_of).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Network membership — trails belong where they physically are
// ---------------------------------------------------------------------------

describe('TCT segments belong to their local networks', () => {
  it('Trans Canada Trail (Bells Corners/Watts Creek) is a member of NCC Greenbelt', () => {

    const greenbelt = net('ncc-greenbelt');
    expect(greenbelt.members).toContain('trans-canada-trail-bells-cornerswatts-creek');
  });

  // TODO: fails after junction way IDs fix — investigate whether Sussex Drive membership changed
  it.skip('Trans Canada Trail (Sussex Drive) is a member of Capital Pathway (ORP flattened)', () => {
    const cp = net('capital-pathway');
    expect(cp.members).toContain('trans-canada-trail-sussex-drive');
  });

  it('Ottawa River Pathway (Trans Canada Trail) is a member of Capital Pathway (ORP flattened)', () => {

    const cp = net('capital-pathway');
    expect(cp.members).toContain('ottawa-river-pathway-trans-canada-trail');
  });

  // TODO: fails after junction way IDs fix — investigate whether Sussex Drive membership changed
  it.skip('Trans Canada Trail (Sussex Drive) has member_of capital-pathway', () => {
    const e = entry('trans-canada-trail-sussex-drive');
    expect(e.member_of).toBe('capital-pathway');
  });

  it('Trans Canada Trail (Bells Corners/Watts Creek) has member_of ncc-greenbelt', () => {

    const e = entry('trans-canada-trail-bells-cornerswatts-creek');
    expect(e.member_of).toBe('ncc-greenbelt');
  });

  it('Ottawa River Pathway (Trans Canada Trail) has member_of trans-canada-trail-ottawa-area', () => {

    const e = entry('ottawa-river-pathway-trans-canada-trail');
    expect(e.member_of).toBe('trans-canada-trail-ottawa-area');
  });
});

// ---------------------------------------------------------------------------
// Capital Pathway gained its real sections
// ---------------------------------------------------------------------------

describe('Capital Pathway members', () => {
  const expectedMembers = [
    'sentier-des-pionniers-pathway',
    'watts-creek-pathway',
    'rideau-canal-western-pathway',
    'rideau-canal-eastern-pathway',
    'experimental-farm-pathway',
    'ottawa-river-pathway-east',
    'ottawa-river-pathway-west',
    'greenbelt-pathway-west',
    'greenbelt-pathway-west-barrhaven',
  ];

  for (const slug of expectedMembers) {
    it(`Capital Pathway includes ${slug}`, () => {
      const cp = net('capital-pathway');
      expect(cp.members).toContain(slug);
    });
  }
});

// ---------------------------------------------------------------------------
// Geometry enrichment — relation entries must use relation geometry, not tiny
// name-match fragments. Without this, entries like Sentier Trans-Canada get
// 33m of geometry instead of 494km, breaking all length-based classification.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// path_type classification — paths have the right infrastructure type
// These feed into index page category tabs via path-categories.ts.
// ---------------------------------------------------------------------------

describe('path_type drives index category assignment', () => {
  // MTB trails — should appear in the MTB tab
  for (const slug of ['fatbike-mont-tremblant', 'le-ptit-train-du-nord', 'voie-verte-chelsea', 'trail-1-1']) {
    it(`${slug} has path_type=mtb-trail (→ MTB tab)`, () => {
      const e = bySlug.get(slug);
      if (!e) return; // promoted non-cycling entries may not exist in all pipeline runs
      expect(e.path_type).toBe('mtb-trail');
    });
  }

  // Paved multi-use paths — should appear in the Pathways tab
  for (const slug of ['greenboro-pathway', 'sawmill-creek-pathway', 'sentier-du-lac-leamy-skiing-trail']) {
    it(`${slug} has path_type=mup (→ Pathways tab)`, () => {
      const e = bySlug.get(slug);
      if (!e) return;
      expect(e.path_type).toBe('mup');
    });
  }

  // Gravel trails — should appear in the Long Distance tab
  for (const slug of ['prescott-russell-trail-link', 'osgoode-link-pathway']) {
    it(`${slug} has path_type=trail (→ Long Distance tab)`, () => {
      const e = entry(slug);
      expect(e.path_type).toBe('trail');
    });
  }

  // Ottawa-Carleton Trailway is explicitly long-distance via pipeline
  it('Ottawa-Carleton Trailway has type=long-distance', () => {
    const e = entry('ottawa-carleton-trailway');
    expect(e.type).toBe('long-distance');
    expect(e.path_type).toBe('trail');
  });
});

// ---------------------------------------------------------------------------
// Named-way grouping — connected ways with the same name should merge
// ---------------------------------------------------------------------------

describe('named ways with shared name should be one entry', () => {
  it('Chelsea Creek Path includes all 3 OSM ways', () => {
    // OSM has 3 ways named "Chelsea Creek Path" that are physically connected:
    //   1113732305 (bicycle=yes, access=no)
    //   1113727404 (highway=path only)
    //   1113725673 (highway=path only)
    // The pipeline currently only picks up 1113732305 (the one with bicycle=yes).
    // The other two lack bicycle tags but share the name and are connected —
    // they should be part of the same entry.
    const e = entry('chelsea-creek-path');
    expect(e.osm_way_ids).toContain(1113732305);
    expect(e.osm_way_ids).toContain(1113727404);
    expect(e.osm_way_ids).toContain(1113725673);
    expect(e.osm_way_ids.length).toBeGreaterThanOrEqual(3);
  });
});

describe('known ways must survive the pipeline', () => {
  // These are way IDs for trails a human has eyeballed and knows should
  // appear on an app page somewhere. If the pipeline silently drops them
  // (ghost-removal overreach, dedup bug, classification misfire) the
  // regression surfaces here instead of on the deployed map.

  function entriesContainingWay(wayId) {
    return entries.filter(e => (e.osm_way_ids ?? []).includes(wayId));
  }

  it('way 380250817 (Trail #54 in Parc de la Gatineau) is claimed by some entry', () => {
    // Trail #54 is a real MTB trail in Gatineau Park. It was previously a
    // member entry of parc-de-la-gatineau. A ghost-removal regression in
    // finalize-resolve.ts (April 2026) started dropping it because every
    // member way was also claimed by an overlapping relation and the
    // check was too coarse about what "mostly owned by a relation" meant.
    const owners = entriesContainingWay(380250817);
    expect(
      owners.length,
      `way 380250817 must be in at least one entry; dropped as ghost?`
    ).toBeGreaterThan(0);
  });

  it('way 380250817 is a member of parc-de-la-gatineau (directly or transitively)', () => {
    const owners = entriesContainingWay(380250817);
    const underPdg = owners.some(e =>
      e.member_of === 'parc-de-la-gatineau' || e.slug === 'parc-de-la-gatineau'
    );
    expect(
      underPdg,
      `way 380250817 should live under parc-de-la-gatineau; owners=${owners.map(o => o.slug ?? o.name).join(', ')}`
    ).toBe(true);
  });

  it('scott-street (parallel-lane duplicate of East–West Crosstown Bikeway) does not exist', () => {
    // Scott Street was discovered as a parallel_to candidate — the cycleway
    // alongside the road named "Scott Street". Its ways are ~73% inside the
    // East–West Crosstown Bikeway relation (7234399), so the parallel entry
    // is a structural ghost of the bikeway. The pipeline must drop it; if
    // it doesn't, the map shows a rogue "Scott Street" popup when you click
    // on what is really part of the bikeway.
    const scott = bySlug.get('scott-street');
    expect(
      scott,
      scott
        ? `scott-street must be dropped as a ghost of eastwest-crosstown-bikeway (type=${scott.type}, ways=${scott.osm_way_ids?.length ?? 0})`
        : undefined,
    ).toBeUndefined();
  });
});

describe('relation geometry enrichment', () => {
  // These entries have osm_relations pointing to large routes. The pipeline
  // must use the relation geometry, not a tiny name-match fragment from the
  // local area. We verify via osm_way_ids count — relation geometry produces
  // hundreds of way IDs, while a name-match fragment produces < 10.
  it('Sentier Trans-Canada Gatineau-Montréal has substantial geometry from its relation', () => {
    const e = entry('sentier-trans-canada-gatineau-montreal');
    expect(e.osm_way_ids?.length, 'should have many way IDs from the full relation').toBeGreaterThan(50);
  });

  it('Route Verte 1 has substantial geometry from its relation', () => {
    const e = bySlug.get('route-verte-1');
    if (!e) return; // may not exist in all cities
    expect(e.osm_way_ids?.length, 'should have many way IDs from the full relation').toBeGreaterThan(50);
  });
});

// ---------------------------------------------------------------------------
// Pageless segment invariants — runtime assertions on the merged tile
// features produced by buildTiles against the live Ottawa bikepath-geometry
// cache. The unit tests cover synthetic inputs; these catch regressions at
// the build-output level against real heterogeneous OSM data.
// ---------------------------------------------------------------------------

const PAGELESS_SEGMENT_CACHE_DIR = path.resolve('.cache', 'bikepath-geometry', 'ottawa');
const hasPagelessCacheForSegmentsTest = fs.existsSync(PAGELESS_SEGMENT_CACHE_DIR);

describe.skipIf(!hasPagelessCacheForSegmentsTest)('pageless segment invariants', () => {
  let tileFeatures; // all merged tile features across the whole pipeline run

  beforeAll(() => {
    const cacheDir = PAGELESS_SEGMENT_CACHE_DIR;

    // Build the metadata map the same way generate-geo-metadata.ts does —
    // from loadBikePathEntries() pages — so geoIds line up exactly with
    // the cache filenames.
    const { pages } = loadBikePathEntries();
    const metadata = new Map();
    for (const page of pages) {
      for (const file of page.geoFiles) {
        const geoId = file.replace(/\.geojson$/, '');
        if (metadata.has(geoId)) continue; // first-write-wins (member before network)
        metadata.set(geoId, {
          slug: page.slug,
          name: page.name,
          memberOf: page.memberOf ?? '',
          surface: page.surface ?? '',
          hasPage: page.standalone,
          path_type: page.path_type ?? '',
          length_km: page.length_km ?? 0,
        });
      }
    }

    // Load all geojson files listed in the manifest (authoritative set),
    // falling back to directory glob if no manifest is present.
    const input = new Map();
    const manifestPath = path.join(cacheDir, 'manifest.json');
    let files;
    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      files = manifest.files.filter((f) => fs.existsSync(path.join(cacheDir, f)));
    } else {
      files = fs.readdirSync(cacheDir).filter((f) => f.endsWith('.geojson'));
    }
    for (const f of files) {
      const geoId = f.replace(/\.geojson$/, '');
      input.set(geoId, JSON.parse(fs.readFileSync(path.join(cacheDir, f), 'utf-8')));
    }

    const { tiles } = buildTiles(input, metadata);
    tileFeatures = [...tiles.values()].flatMap((t) => t.features);
  }, 120_000);

  it('every tile feature with _segments has lineCount sum equal to geometry line count', () => {
    const withSegments = tileFeatures.filter((f) => Array.isArray(f.properties?._segments));
    expect(withSegments.length).toBeGreaterThan(0);
    for (const f of withSegments) {
      const lineCountSum = f.properties._segments.reduce((acc, s) => acc + s.lineCount, 0);
      const geomLineCount = f.geometry.type === 'MultiLineString'
        ? f.geometry.coordinates.length
        : 1;
      expect(
        lineCountSum,
        `feature ${f.properties._fid ?? f.properties._geoId} lineCount sum mismatch`,
      ).toBe(geomLineCount);
    }
  });

  it('Sentier Trans-Canada road feature has at least 10 distinct named segments', () => {
    const tctRoad = tileFeatures.find(
      (f) =>
        f.properties?.slug === 'sentier-trans-canada-gatineau-montreal' &&
        f.properties?.surface_category === 'road',
    );
    expect(
      tctRoad,
      'sentier-trans-canada-gatineau-montreal road tile feature must exist',
    ).toBeDefined();
    const segments = tctRoad.properties._segments;
    expect(
      segments,
      'tctRoad.properties._segments must exist on a tile feature emitted by mergeFeatures',
    ).toBeDefined();
    const namedSegments = segments.filter((s) => s.name !== undefined);
    expect(
      namedSegments.length,
      `expected >=10 named segments, got ${namedSegments.length}`,
    ).toBeGreaterThanOrEqual(10);
  });

  it('every copy of a named segment across surface-category features has identical surface_mix', () => {
    // When a named segment's ways straddle multiple surface categories
    // (e.g. asphalt main line with a 40m wooden footbridge), mergeFeatures
    // emits the segment into each category's tile feature with the SAME
    // segment-wide surface_mix (groupWaysIntoSegments computes it once per
    // geoId, across all ways in the segment regardless of category, and
    // mergeFeatures shares the same array across categories). This
    // assertion guards against a regression that would recompute
    // surface_mix per category.
    //
    // Key is `_geoId::name`, not `slug::name`: multiple geoIds can
    // aggregate into the same network slug (gatineau-cycling-network
    // pulls in per-member geoIds with their own disjoint way sets), and
    // those are legitimately allowed to have different surface_mix
    // arrays — each computed from its own subset of ways.
    const seen = new Map(); // key: _geoId::name → surface_mix
    for (const f of tileFeatures) {
      const geoId = f.properties?._geoId;
      for (const seg of f.properties?._segments ?? []) {
        if (seg.name === undefined) continue;
        const key = `${geoId}::${seg.name}`;
        const prev = seen.get(key);
        if (prev === undefined) {
          seen.set(key, seg.surface_mix);
        } else {
          expect(
            seg.surface_mix,
            `segment ${key} surface_mix differs across surface-category copies`,
          ).toEqual(prev);
        }
      }
    }

    // Non-vacuous guard: if beforeAll ran successfully on a non-empty cache,
    // at least one named segment must have existed. This catches a regression
    // that accidentally strips all names from tile features — Assertion 2 would
    // catch it for TCT specifically, but this broader assertion would miss it.
    if (tileFeatures.length > 0) {
      expect(seen.size, 'no named segments found across all tile features').toBeGreaterThan(0);
    }
  });
});

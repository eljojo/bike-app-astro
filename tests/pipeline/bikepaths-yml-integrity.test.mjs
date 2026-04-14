/**
 * Integrity tests for Ottawa bikepaths.yml.
 *
 * These assert real-world geographic and classification facts about Ottawa's
 * cycling infrastructure. If the pipeline changes break these, the data is wrong.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

const CONTENT_DIR = process.env.CONTENT_DIR || path.join(process.env.HOME, 'code', 'bike-routes');
const ymlPath = path.join(CONTENT_DIR, 'ottawa', 'bikepaths.yml');
const ymlExists = fs.existsSync(ymlPath);

let entries;
let bySlug;
let byName;

beforeAll(() => {
  if (!ymlExists) return;
  const data = yaml.load(fs.readFileSync(ymlPath, 'utf-8'));
  entries = data.bike_paths;
  bySlug = new Map(entries.filter(e => e.slug).map(e => [e.slug, e]));
  byName = new Map(entries.map(e => [e.name, e]));
});

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

describe.skipIf(!ymlExists)('long-distance classification', () => {
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
    if (!entries) return;
    const e = entry('sentier-trans-canada-gatineau-montreal');
    expect(e.type).toBe('long-distance');
  });

  it('Sentier Trans-Canada Gatineau-Montréal has no member_of (too large for any local network)', () => {
    if (!entries) return;
    const e = entry('sentier-trans-canada-gatineau-montreal');
    expect(e.member_of).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Network membership — trails belong where they physically are
// ---------------------------------------------------------------------------

describe.skipIf(!ymlExists)('TCT segments belong to their local networks', () => {
  it('Trans Canada Trail (Bells Corners/Watts Creek) is a member of NCC Greenbelt', () => {
    if (!entries) return;
    const greenbelt = net('ncc-greenbelt');
    expect(greenbelt.members).toContain('trans-canada-trail-bells-cornerswatts-creek');
  });

  it('Trans Canada Trail (Sussex Drive) is a member of Capital Pathway (ORP flattened)', () => {
    if (!entries) return;
    const cp = net('capital-pathway');
    expect(cp.members).toContain('trans-canada-trail-sussex-drive');
  });

  it('Ottawa River Pathway (Trans Canada Trail) is a member of Capital Pathway (ORP flattened)', () => {
    if (!entries) return;
    const cp = net('capital-pathway');
    expect(cp.members).toContain('ottawa-river-pathway-trans-canada-trail');
  });

  it('Trans Canada Trail (Sussex Drive) has member_of capital-pathway', () => {
    if (!entries) return;
    const e = entry('trans-canada-trail-sussex-drive');
    expect(e.member_of).toBe('capital-pathway');
  });

  it('Trans Canada Trail (Bells Corners/Watts Creek) has member_of ncc-greenbelt', () => {
    if (!entries) return;
    const e = entry('trans-canada-trail-bells-cornerswatts-creek');
    expect(e.member_of).toBe('ncc-greenbelt');
  });

  it('Ottawa River Pathway (Trans Canada Trail) has member_of trans-canada-trail-ottawa-area', () => {
    if (!entries) return;
    const e = entry('ottawa-river-pathway-trans-canada-trail');
    expect(e.member_of).toBe('trans-canada-trail-ottawa-area');
  });
});

// ---------------------------------------------------------------------------
// Capital Pathway gained its real sections
// ---------------------------------------------------------------------------

describe.skipIf(!ymlExists)('Capital Pathway members', () => {
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

describe.skipIf(!ymlExists)('path_type drives index category assignment', () => {
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

describe.skipIf(!ymlExists)('named ways with shared name should be one entry', () => {
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

describe.skipIf(!ymlExists)('relation geometry enrichment', () => {
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

/**
 * Index page category classification — expected behaviour.
 *
 * Loads real Ottawa bikepaths.yml and asserts that specific paths land in
 * the correct browse tab. These tests document expectations that the
 * current classification does NOT satisfy — they should FAIL until the
 * classification logic is updated.
 *
 * Pattern: same as bikepaths-yml-integrity.test.mjs — real data, real assertions.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import {
  classifyIndependentPath,
  splitMemberTiers,
  type BrowseCategory,
} from '../../src/lib/bike-paths/index-categories';

// ── Data loading (same pattern as bikepaths-yml-integrity.test.mjs) ─

const CONTENT_DIR = process.env.CONTENT_DIR || path.join(process.env.HOME!, 'code', 'bike-routes');
const ymlPath = path.join(CONTENT_DIR, 'ottawa', 'bikepaths.yml');
const ymlExists = fs.existsSync(ymlPath);

interface YmlEntry {
  slug: string;
  name: string;
  type: string;
  path_type?: string;
  network?: string;
  member_of?: string;
  members?: string[];
  mtb?: boolean;
  osm_way_ids?: number[];
  width?: string;
  access?: string;
}

let entries: YmlEntry[];
let bySlug: Map<string, YmlEntry>;

beforeAll(() => {
  if (!ymlExists) return;
  const data = yaml.load(fs.readFileSync(ymlPath, 'utf-8')) as { bike_paths: YmlEntry[] };
  entries = data.bike_paths;
  bySlug = new Map(entries.filter(e => e.slug).map(e => [e.slug, e]));
});

function entry(slug: string): YmlEntry {
  const e = bySlug.get(slug);
  expect(e, `entry ${slug} must exist in bikepaths.yml`).toBeDefined();
  return e!;
}

// ── Helpers ─────────────────────────────────────────────────────────

/** What category does the current classification assign to this independent path? */
function independentCategory(slug: string): BrowseCategory | 'all' {
  const e = entry(slug);
  return classifyIndependentPath(e.type, e.path_type) ?? 'all';
}

// ── MTB tab ─────────────────────────────────────────────────────────

describe.skipIf(!ymlExists)('independent paths that should be in MTB tab', () => {
  const shouldBeMtb = [
    'fatbike-mont-tremblant',
    'le-ptit-train-du-nord',
    'voie-verte-chelsea',
    'trail-1-1',
  ];

  // ── Root cause investigation: fatbike-mont-tremblant ──────────────
  // Hypothesis: classifyIndependentPath only receives entryType, never
  // sees path_type. The function signature is the bug.

  it('fatbike-mont-tremblant has path_type=mtb-trail in the YML', () => {
    const e = entry('fatbike-mont-tremblant');
    expect(e.path_type).toBe('mtb-trail');
  });

  it('fatbike-mont-tremblant has entryType=destination (not mtb-related)', () => {
    const e = entry('fatbike-mont-tremblant');
    expect(e.type).toBe('destination');
  });

  it('classifyIndependentPath now uses path_type to classify mtb-trail paths', () => {
    const e = entry('fatbike-mont-tremblant');
    // Now the function receives both entryType and path_type
    const result = classifyIndependentPath(e.type, e.path_type);
    // It returns 'mtb' because path_type=mtb-trail is now passed
    expect(result).toBe('mtb');
    // The mtb-trail signal in path_type is correctly used
    expect(e.path_type).toBe('mtb-trail'); // the data IS there
  });

  for (const slug of shouldBeMtb) {
    it(`${slug} → mtb`, () => {
      expect(independentCategory(slug)).toBe('mtb');
    });
  }
});

// ── Trails tab (gravel / long distance) ─────────────────────────────
// Unpaved trails and pipeline-classified long-distance paths share one
// tab. The signal is path_type=trail OR entryType=long-distance.

describe.skipIf(!ymlExists)('independent paths that should be in Trails tab', () => {
  const shouldBeTrails = [
    'prescott-russell-trail-link',
    'osgoode-link-pathway',
  ];

  for (const slug of shouldBeTrails) {
    it(`${slug} → trails`, () => {
      expect(independentCategory(slug)).toBe('trails');
    });
  }
});

// ── Pathways tab ────────────────────────────────────────────────────

describe.skipIf(!ymlExists)('independent paths that should be in Pathways tab', () => {
  const shouldBePathways = [
    'greenboro-pathway',
    'sawmill-creek-pathway',
    'sentier-du-lac-leamy-skiing-trail',
  ];

  for (const slug of shouldBePathways) {
    it(`${slug} → pathways`, () => {
      expect(independentCategory(slug)).toBe('pathways');
    });
  }
});

// ── Tier2 display threshold ─────────────────────────────────────────

// ── Pathways tab — markdown-only grouping pages ─────────────────────

describe.skipIf(!ymlExists)('markdown grouping pages should be classified', () => {
  // gatineau-cycling-network is markdown-only (no YML entry). It uses
  // includes: to claim 9 Gatineau-side MUPs. Two problems:
  //
  // 1. Category: its primary entry (sentier-du-ruisseau-de-la-brasserie-pathway)
  //    has type=destination, path_type=mup. classifyIndependentPath only checks
  //    entryType, so it falls to "all". Same root cause as other MUP paths.
  //
  // 2. Display: includes: pages don't get memberRefs in the build, so they
  //    can't show as expandable networks. This is a build layer gap —
  //    includes: should produce the same structure as YML members:.

  it('gatineau-cycling-network primary entry is a MUP → should be pathways', () => {
    const primary = entry('sentier-du-ruisseau-de-la-brasserie-pathway');
    expect(primary.path_type).toBe('mup');
    expect(classifyIndependentPath(primary.type, primary.path_type)).toBe('pathways');
  });
});

// ── Page eligibility — minimum length ───────────────────────────────

describe.skipIf(!ymlExists)('very short paths should not get standalone pages', () => {
  // Root cause: deriveEntryType (entry-type.mjs line 129-134) gives
  // mtb-trail paths type=destination if length >= 1km. But 1km is
  // necessary, not sufficient. chelsea-creek-path passes the threshold
  // but is a barely-rideable stub — 1 way, 80cm wide, access=no.
  // The pipeline should consider way count or other quality signals.

  it('chelsea-creek-path is a single-way stub with restrictive characteristics', () => {
    const e = entry('chelsea-creek-path');
    expect(e.osm_way_ids).toHaveLength(1);
    expect(e.width).toBe('0.8');       // 80cm — barely a path
    expect(e.access).toBe('no');       // restricted access
    expect(e.path_type).toBe('mtb-trail');
  });

  it('chelsea-creek-path should not get type=destination from the pipeline', () => {
    const e = entry('chelsea-creek-path');
    // The pipeline gives it destination because length >= 1km.
    // But a single-way, 80cm-wide, access-restricted path is not
    // a destination anyone would plan to visit.
    expect(e.type).not.toBe('destination');
  });
});

// ── Tier2 display threshold ─────────────────────────────────────────

describe('networks with 3 or fewer short segments should show them inline', () => {
  it('tier2 members are promoted to tier1 when count <= 3', () => {
    const members = [
      { hasMarkdown: true, length_km: 10 },   // already tier1
      { hasMarkdown: false, length_km: 1 },    // short → tier2
      { hasMarkdown: false, length_km: 2 },    // short → tier2
    ];
    const { tier1, tier2 } = splitMemberTiers(members);
    // Expectation: with only 2 short segments, they should be shown
    // inline (promoted to tier1), not collapsed behind "+ 2 shorter segments"
    expect(tier2).toHaveLength(0);
    expect(tier1).toHaveLength(3);
  });
});

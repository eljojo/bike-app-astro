/**
 * Ottawa bikepaths pipeline regression suite — classification edition.
 *
 * Runs the full bikepaths pipeline for Ottawa in-memory and asserts that
 * specific slugs land in the correct browse tab (MTB / Trails / Pathways),
 * and that well-known pipeline-layer decisions (path_type, access,
 * member_of, etc.) match expectations.
 *
 * These tests do NOT read `bikepaths.yml` from disk — they run the same
 * `buildBikepathsPipeline()` the generator script uses and inspect the
 * resulting in-memory entries array. Pipeline setup is shared with
 * bikepaths-yml-integrity.test.mjs via tests/pipeline/ottawa-pipeline.ts.
 *
 * When an assertion fails, the error message includes the full per-entry
 * trace timeline (every phase that touched the subject and what decision
 * it recorded), so regression diagnosis pinpoints the responsible phase.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import {
  classifyIndependentPath,
  splitMemberTiers,
  type BrowseCategory,
} from '../../src/lib/bike-paths/index-categories';
import {
  loadOttawaPipelineResult,
  traceTimeline,
  type OttawaPipelineResult,
} from '../pipeline/ottawa-pipeline.ts';

let pipeline: OttawaPipelineResult;

beforeAll(async () => {
  pipeline = await loadOttawaPipelineResult();
}, 300_000);

// ── Helpers ─────────────────────────────────────────────────────────

/** Look up an entry by slug; fail the test with a clear message if missing. */
function requireEntry(slug: string): any {
  const e = pipeline.bySlug.get(slug);
  expect(e, `entry ${slug} must exist in the Ottawa pipeline output`).toBeDefined();
  return e!;
}

/** Trace-timeline suffix for enriched assertion failure messages. */
function traceCtx(entry: { name: string }): string {
  return `\nDecision timeline for entry:${entry.name}:\n${traceTimeline(pipeline.trace, entry.name)}`;
}

/** What category does the current classification assign to this independent path? */
function independentCategory(entry: { type: string; path_type?: string }): BrowseCategory | 'all' {
  return classifyIndependentPath(entry.type, entry.path_type) ?? 'all';
}

// ── MTB tab ─────────────────────────────────────────────────────────

describe('independent paths that should be in MTB tab', () => {
  const shouldBeMtb = [
    'fatbike-mont-tremblant',
    'le-ptit-train-du-nord',
    'voie-verte-chelsea',
    'trail-1-1',
  ];

  it('fatbike-mont-tremblant has path_type=mtb-trail', () => {
    const e = requireEntry('fatbike-mont-tremblant');
    expect(e.path_type, `fatbike-mont-tremblant path_type${traceCtx(e)}`).toBe('mtb-trail');
  });

  it('fatbike-mont-tremblant has entryType=destination', () => {
    const e = requireEntry('fatbike-mont-tremblant');
    expect(e.type, `fatbike-mont-tremblant type${traceCtx(e)}`).toBe('destination');
  });

  it('classifyIndependentPath uses path_type to classify mtb-trail paths', () => {
    const e = requireEntry('fatbike-mont-tremblant');
    const result = classifyIndependentPath(e.type, e.path_type);
    expect(result, `fatbike-mont-tremblant classification${traceCtx(e)}`).toBe('mtb');
    expect(e.path_type).toBe('mtb-trail');
  });

  for (const slug of shouldBeMtb) {
    it(`${slug} → mtb`, () => {
      const e = requireEntry(slug);
      expect(independentCategory(e), `${slug} category${traceCtx(e)}`).toBe('mtb');
    });
  }
});

// ── Trails tab (gravel / long distance) ─────────────────────────────
// Unpaved trails and pipeline-classified long-distance paths share one
// tab. The signal is path_type=trail OR entryType=long-distance.

describe('independent paths that should be in Trails tab', () => {
  const shouldBeTrails = [
    'prescott-russell-trail-link',
    'osgoode-link-pathway',
  ];

  for (const slug of shouldBeTrails) {
    it(`${slug} → trails`, () => {
      const e = requireEntry(slug);
      expect(independentCategory(e), `${slug} category${traceCtx(e)}`).toBe('trails');
    });
  }
});

// ── Pathways tab ────────────────────────────────────────────────────

describe('independent paths that should be in Pathways tab', () => {
  const shouldBePathways = [
    'greenboro-pathway',
    'sawmill-creek-pathway',
    'sentier-du-lac-leamy-skiing-trail',
  ];

  for (const slug of shouldBePathways) {
    it(`${slug} → pathways`, () => {
      const e = requireEntry(slug);
      expect(independentCategory(e), `${slug} category${traceCtx(e)}`).toBe('pathways');
    });
  }
});

// ── Markdown grouping pages ─────────────────────────────────────────

describe('markdown grouping pages should be classified', () => {
  // gatineau-cycling-network is markdown-only (no OSM-driven entry). It
  // uses `includes:` to claim 9 Gatineau-side MUPs. Its primary entry
  // (sentier-du-ruisseau-de-la-brasserie-pathway) is a MUP and should
  // classify to pathways.
  it('gatineau-cycling-network primary entry is a MUP → should be pathways', () => {
    const primary = requireEntry('sentier-du-ruisseau-de-la-brasserie-pathway');
    expect(primary.path_type, `primary entry path_type${traceCtx(primary)}`).toBe('mup');
    expect(
      classifyIndependentPath(primary.type, primary.path_type),
      `primary entry classification${traceCtx(primary)}`,
    ).toBe('pathways');
  });
});

// ── Page eligibility — minimum length ───────────────────────────────

describe('very short paths should not get standalone pages', () => {
  // Root cause: deriveEntryType (entry-type.mjs line 129-134) gives
  // mtb-trail paths type=destination if length >= 1km. But 1km is
  // necessary, not sufficient. chelsea-creek-path passes the threshold
  // but is a barely-rideable stub — 1 way, 80cm wide, access=no.
  // The pipeline should consider way count or other quality signals.

  it('chelsea-creek-path is a short access-restricted trail', () => {
    const e = requireEntry('chelsea-creek-path');
    expect(e.access, `chelsea-creek-path access${traceCtx(e)}`).toBe('no');
    expect(e.path_type, `chelsea-creek-path path_type${traceCtx(e)}`).toBe('mtb-trail');
    // No osm_relations — this is a named-way discovery, not a route
    expect(e.osm_relations, `chelsea-creek-path osm_relations${traceCtx(e)}`).toBeUndefined();
    // Not in any network
    expect(e.member_of, `chelsea-creek-path member_of${traceCtx(e)}`).toBeUndefined();
  });

  it('chelsea-creek-path should not get type=destination from the pipeline', () => {
    const e = requireEntry('chelsea-creek-path');
    // Pipeline gives it destination because it's a named mtb-trail with
    // length >= 1km (entry-type.mjs:132). But a single-way, access=no,
    // non-relation path with no network is not a destination.
    // The pipeline needs a stronger signal than just length for
    // standalone mtb-trail paths (e.g., minimum way count, or
    // access=no should disqualify).
    expect(e.type, `chelsea-creek-path type${traceCtx(e)}`).not.toBe('destination');
  });
});

// ── Tier2 display threshold (synthetic — no pipeline needed) ────────

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

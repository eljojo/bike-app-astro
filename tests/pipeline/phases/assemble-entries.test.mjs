import { describe, it, expect } from 'vitest';
import { assembleEntriesPhase } from '../../../scripts/pipeline/phases/assemble-entries.ts';
import { Trace } from '../../../scripts/pipeline/engine/trace.mjs';
import { WayRegistry } from '../../../scripts/pipeline/lib/way-registry.mjs';

const ADAPTER = { relationNamePattern: '', namedWayQueries: () => [] };

describe('assemble.entries phase', () => {
  it('returns empty when discovered data is empty', async () => {
    const trace = new Trace();
    const wayRegistry = new WayRegistry();
    const out = await assembleEntriesPhase({
      discovered: { osmRelations: [], osmNamedWays: [], parallelLanes: [], nonCyclingCandidates: [], relationBaseNames: new Set() },
      manualEntries: [],
      wayRegistry,
      ctx: {
        bbox: '0,0,1,1', adapter: ADAPTER,
        queryOverpass: async () => ({ elements: [] }),
        trace: trace.bind('assemble.entries'),
      },
    });
    expect(out).toEqual([]);
  });

  it('builds an entry from a relation and claims its member ways', async () => {
    const REL = {
      id: 100, name: 'Test Trail',
      tags: { name: 'Test Trail', route: 'bicycle', highway: 'cycleway' },
      _memberWayIds: [501, 502],
    };
    const trace = new Trace();
    const wayRegistry = new WayRegistry();
    const out = await assembleEntriesPhase({
      discovered: { osmRelations: [REL], osmNamedWays: [], parallelLanes: [], nonCyclingCandidates: [], relationBaseNames: new Set() },
      manualEntries: [],
      wayRegistry,
      ctx: {
        bbox: '0,0,1,1', adapter: ADAPTER,
        queryOverpass: async () => ({ elements: [] }),
        trace: trace.bind('assemble.entries'),
      },
    });
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('Test Trail');
    expect(out[0].osm_relations).toEqual([100]);
    expect(wayRegistry.wayIdsFor(out[0]).has(501)).toBe(true);
    expect(wayRegistry.wayIdsFor(out[0]).has(502)).toBe(true);
  });

  it('does not create duplicate entry when named ways have different-name variants of the relation name', async () => {
    // Cycloparc PPJ regression: a relation "Cycloparc PPJ" covers three
    // member ways (501, 502, 503). Two of them are tagged "PPJ Cycloparc"
    // (typo variant) and one is tagged "Cycloparc PPJ". Named-way
    // discovery would produce two clusters, but because the ways overlap
    // the relation member list, both clusters must merge into the single
    // relation entry — no duplicate.
    const REL = {
      id: 1623089, name: 'Cycloparc PPJ',
      tags: { name: 'Cycloparc PPJ', route: 'bicycle', network: 'lcn', ref: 'PPJ 1' },
      _memberWayIds: [501, 502, 503],
    };
    // Two named-way clusters discovered by name matching
    const PPJ_TYPO = {
      name: 'PPJ Cycloparc',
      wayCount: 2,
      tags: { highway: 'cycleway', name: 'PPJ Cycloparc', surface: 'fine_gravel' },
      anchors: [[-76.39, 45.57]],
      osmNames: ['PPJ Cycloparc'],
      _wayIds: [501, 502],
    };
    const PPJ_CANONICAL = {
      name: 'Cycloparc PPJ',
      wayCount: 1,
      tags: { highway: 'cycleway', name: 'Cycloparc PPJ', surface: 'asphalt' },
      anchors: [[-76.36, 45.54]],
      osmNames: ['Cycloparc PPJ'],
      _wayIds: [503],
    };
    const trace = new Trace();
    const wayRegistry = new WayRegistry();
    const out = await assembleEntriesPhase({
      discovered: {
        osmRelations: [REL],
        osmNamedWays: [PPJ_TYPO, PPJ_CANONICAL],
        parallelLanes: [],
        nonCyclingCandidates: [],
        relationBaseNames: new Set(),
      },
      manualEntries: [],
      wayRegistry,
      ctx: {
        bbox: '45.3,-76.6,45.7,-75.5', adapter: ADAPTER,
        queryOverpass: async () => ({ elements: [] }),
        trace: trace.bind('assemble.entries'),
      },
    });
    const cycloparc = out.filter((e) =>
      e.name.toLowerCase().includes('cycloparc') || e.name.toLowerCase().includes('ppj'),
    );
    expect(cycloparc).toHaveLength(1);
    expect(cycloparc[0].osm_relations).toContain(1623089);
    // The relation entry claims all three ways
    const claimed = wayRegistry.wayIdsFor(cycloparc[0]);
    expect(claimed.has(501)).toBe(true);
    expect(claimed.has(502)).toBe(true);
    expect(claimed.has(503)).toBe(true);
  });

  it('merges a parallel lane into an existing manual entry and keeps the worse facts', async () => {
    // Manual entry for McArthur Avenue (a real road) already exists with
    // highway=secondary. A parallel-lane candidate for the same road name
    // should merge into it as `parallel_to` — NOT produce a second entry
    // — and the existing "worse" road facts (highway=secondary, cycleway=lane)
    // must not be overwritten by the cycleway's better facts.
    const manualMcArthur = {
      name: 'McArthur Avenue',
      osm_names: ['McArthur Avenue'],
      highway: 'secondary',
      cycleway: 'lane',
      surface: 'asphalt',
      anchors: [[-75.668, 45.430], [-75.642, 45.432]],
    };
    const parallelCandidate = {
      name: 'McArthur Avenue',
      parallel_to: 'McArthur Avenue',
      anchors: [[-75.66, 45.43], [-75.64, 45.43]],
      tags: { highway: 'cycleway', surface: 'asphalt', width: '1.5' },
    };
    const trace = new Trace();
    const wayRegistry = new WayRegistry();
    const out = await assembleEntriesPhase({
      discovered: {
        osmRelations: [],
        osmNamedWays: [],
        parallelLanes: [parallelCandidate],
        nonCyclingCandidates: [],
        relationBaseNames: new Set(),
      },
      manualEntries: [manualMcArthur],
      wayRegistry,
      ctx: {
        bbox: '45.15,-76.35,45.65,-75.35', adapter: ADAPTER,
        queryOverpass: async () => ({ elements: [] }),
        trace: trace.bind('assemble.entries'),
      },
    });
    const mcArthur = out.filter((e) => e.name === 'McArthur Avenue');
    expect(mcArthur).toHaveLength(1);
    // Parallel merge populated parallel_to without clobbering the worse road facts
    expect(mcArthur[0].parallel_to).toBe('McArthur Avenue');
    expect(mcArthur[0].highway).toBe('secondary');
    expect(mcArthur[0].cycleway).toBe('lane');
  });

  it('does not bleed way-level wikidata onto a relation entry (Adàwe regression)', async () => {
    // Relation has its own wikidata. A named way merged into the relation
    // entry must NOT overwrite it.
    const REL = {
      id: 200, name: 'Adàwe Crossing',
      tags: { name: 'Adàwe Crossing', route: 'bicycle', wikidata: 'Q12345' },
      _memberWayIds: [600],
    };
    const NW = {
      name: 'Adàwe Crossing',
      wayCount: 1,
      tags: { wikidata: 'Q99999' }, // bad wikidata on a member way
      anchors: [[0, 0]],
      osmNames: ['Adàwe Crossing'],
      _wayIds: [600],
    };
    const trace = new Trace();
    const wayRegistry = new WayRegistry();
    const out = await assembleEntriesPhase({
      discovered: { osmRelations: [REL], osmNamedWays: [NW], parallelLanes: [], nonCyclingCandidates: [], relationBaseNames: new Set() },
      manualEntries: [],
      wayRegistry,
      ctx: {
        bbox: '0,0,1,1', adapter: ADAPTER,
        queryOverpass: async () => ({ elements: [] }),
        trace: trace.bind('assemble.entries'),
      },
    });
    const adawe = out.find((e) => e.name === 'Adàwe Crossing');
    expect(adawe).toBeDefined();
    // Relation's wikidata wins; way's bad value is NOT propagated
    expect(adawe.wikidata).toBe('Q12345');
  });

  it('does not bleed wikidata/wikipedia/bilingual names from a member way onto a relation with none of those', async () => {
    // Crosstown Bikeway 3 regression: the relation has NO wikidata,
    // wikipedia, name:en or name:fr. One of its member ways is the
    // Adàwe Crossing bridge, which DOES have all of those. The bridge's
    // identity tags must not bleed up to the bikeway entry.
    const REL = {
      id: 10985930, name: 'Crosstown Bikeway 3',
      tags: {
        name: 'Crosstown Bikeway 3', route: 'bicycle', network: 'lcn',
        ref: '3', cycle_network: 'CA:ON:Ottawa',
      },
      _memberWayIds: [701, 702],
    };
    // A named-way cluster built from the bridge way — has identity tags
    // that should NOT propagate to the relation entry.
    const BRIDGE_CLUSTER = {
      name: 'Crosstown Bikeway 3',
      wayCount: 1,
      tags: {
        highway: 'cycleway', surface: 'concrete',
        wikidata: 'Q48796246',
        wikipedia: 'en:Adàwe Crossing',
        'name:en': 'Adàwe crossing',
        'name:fr': 'passerelle Adàwe',
      },
      anchors: [[-75.635, 45.425]],
      osmNames: ['Crosstown Bikeway 3'],
      _wayIds: [701],
    };
    const NORMAL_CLUSTER = {
      name: 'Crosstown Bikeway 3',
      wayCount: 1,
      tags: { highway: 'cycleway', surface: 'asphalt' },
      anchors: [[-75.625, 45.435]],
      osmNames: ['Crosstown Bikeway 3'],
      _wayIds: [702],
    };
    const trace = new Trace();
    const wayRegistry = new WayRegistry();
    const out = await assembleEntriesPhase({
      discovered: {
        osmRelations: [REL],
        osmNamedWays: [BRIDGE_CLUSTER, NORMAL_CLUSTER],
        parallelLanes: [],
        nonCyclingCandidates: [],
        relationBaseNames: new Set(),
      },
      manualEntries: [],
      wayRegistry,
      ctx: {
        bbox: '45.3,-76.0,45.5,-75.5', adapter: ADAPTER,
        queryOverpass: async () => ({ elements: [] }),
        trace: trace.bind('assemble.entries'),
      },
    });
    const bikeway = out.find((e) => e.name === 'Crosstown Bikeway 3');
    expect(bikeway).toBeDefined();
    // The relation has no wikidata/wikipedia — the bridge's must not bleed up
    expect(bikeway.wikidata).toBeUndefined();
    expect(bikeway.wikipedia).toBeUndefined();
    // Bilingual names from the bridge must not overwrite the relation's name
    expect(bikeway.name_en).toBeUndefined();
    expect(bikeway.name_fr).toBeUndefined();
  });
});

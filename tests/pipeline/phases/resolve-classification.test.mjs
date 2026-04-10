import { describe, it, expect } from 'vitest';
import { resolveClassificationPhase } from '../../../scripts/pipeline/phases/resolve-classification.ts';
import { Trace } from '../../../scripts/pipeline/engine/trace.mjs';
import { WayRegistry } from '../../../scripts/pipeline/lib/way-registry.mjs';

const ADAPTER = { relationNamePattern: '', namedWayQueries: () => [] };

describe('resolve.classification phase', () => {
  it('passes empty entries through unchanged', async () => {
    const trace = new Trace();
    const wayRegistry = new WayRegistry();
    const out = await resolveClassificationPhase({
      entries: [],
      discovered: { osmRelations: [], osmNamedWays: [], parallelLanes: [], nonCyclingCandidates: [], relationBaseNames: new Set() },
      wayRegistry,
      ctx: {
        bbox: '0,0,1,1', adapter: ADAPTER,
        queryOverpass: async () => ({ elements: [] }),
        trace: trace.bind('resolve.classification'),
      },
    });
    expect(out).toEqual([]);
  });

  it('derives entry types for cycling entries', async () => {
    const trace = new Trace();
    const wayRegistry = new WayRegistry();
    const entries = [
      {
        name: 'Real Trail',
        highway: 'cycleway',
        path_type: 'mup',
        _ways: [[
          { lat: 45.5, lon: -75.7 },
          { lat: 45.51, lon: -75.7 }, // ~1.1km — should be destination
          { lat: 45.52, lon: -75.7 },
        ]],
        osm_relations: [],
        osm_names: ['Real Trail'],
      },
    ];
    const out = await resolveClassificationPhase({
      entries,
      discovered: { osmRelations: [], osmNamedWays: [], parallelLanes: [], nonCyclingCandidates: [], relationBaseNames: new Set() },
      wayRegistry,
      ctx: {
        bbox: '0,0,1,1', adapter: ADAPTER,
        queryOverpass: async () => ({ elements: [] }),
        trace: trace.bind('resolve.classification'),
      },
    });
    // deriveEntryType should set a type — at minimum, not undefined
    expect(out[0].type).toBeDefined();
  });

  it('promotes a >=90% bikeable non-cycling relation candidate to a real entry', async () => {
    const trace = new Trace();
    const wayRegistry = new WayRegistry();
    const cyclingEntry = {
      name: 'Real Cycling Trail',
      _ways: [[{ lat: 45.5, lon: -75.7 }, { lat: 45.51, lon: -75.71 }]],
      osm_relations: [123],
      osm_names: ['Real Cycling Trail'],
    };
    wayRegistry.claim(cyclingEntry, [501]);
    const entries = [cyclingEntry];

    const candidate = {
      id: 999,
      name: 'Some Hiking Trail',
      route: 'hiking',
      bikeableWayIds: [501],
      bikeablePct: 1.0, // 100% bikeable → promoted
    };

    const out = await resolveClassificationPhase({
      entries,
      discovered: {
        osmRelations: [],
        osmNamedWays: [],
        parallelLanes: [],
        nonCyclingCandidates: [candidate],
        relationBaseNames: new Set(),
      },
      wayRegistry,
      ctx: {
        bbox: '0,0,1,1', adapter: ADAPTER,
        queryOverpass: async () => ({ elements: [] }),
        trace: trace.bind('resolve.classification'),
      },
    });

    const promoted = out.find((e) => e.name === 'Some Hiking Trail');
    expect(promoted).toBeDefined();
    expect(promoted.osm_relations).toEqual([999]);
    expect(promoted.route_type).toBe('hiking');
  });

  it("promotes a 100% bikeable piste relation (Le P'tit Train du Nord regression)", async () => {
    // Le P'tit Train du Nord: tagged route=piste in OSM, but every member
    // way is highway=cycleway. Those ways are the truth — this IS a bike
    // path. The piste tag is a fact about the entry, not its identity.
    const trace = new Trace();
    const wayRegistry = new WayRegistry();
    // No existing cycling entry — the relation is the only claim on these ways
    const entries = [];
    const pisteCandidate = {
      id: 8880002,
      name: "Le P'tit Train du Nord",
      route: 'piste',
      bikeableWayIds: [7701, 7702, 7703],
      bikeablePct: 1.0, // 100% bikeable
    };
    const out = await resolveClassificationPhase({
      entries,
      discovered: {
        osmRelations: [],
        osmNamedWays: [],
        parallelLanes: [],
        nonCyclingCandidates: [pisteCandidate],
        relationBaseNames: new Set(),
      },
      wayRegistry,
      ctx: {
        bbox: '45.7,-74.2,45.9,-73.9', adapter: ADAPTER,
        queryOverpass: async () => ({ elements: [] }),
        trace: trace.bind('resolve.classification'),
      },
    });
    const ptdn = out.find((e) => e.name === "Le P'tit Train du Nord");
    expect(ptdn).toBeDefined();
    expect(ptdn.route_type).toBe('piste');
    expect(ptdn.osm_relations).toEqual([8880002]);
    expect(ptdn.osm_way_ids).toEqual([7701, 7702, 7703]);
    expect(trace.subject(`entry:${ptdn.name}`).events.map((e) => e.kind)).toContain('promoted');
  });

  it('keeps a low-bikeable relation as overlap metadata on sharing cycling entries, does not promote', async () => {
    // RT Bells Corners Blue Loop: only 33% bikeable. Must NOT be promoted.
    // Instead, the existing cycling entry that owns the shared way gets
    // overlapping_relations metadata.
    const trace = new Trace();
    const wayRegistry = new WayRegistry();
    const cyclingEntry = {
      name: 'Greenbelt Pathway',
      _ways: [[{ lat: 45.33, lon: -75.85 }, { lat: 45.34, lon: -75.84 }]],
      osm_relations: [6660001],
      osm_names: ['Greenbelt Pathway'],
    };
    wayRegistry.claim(cyclingEntry, [6601]);
    const entries = [cyclingEntry];
    const overlapCandidate = {
      id: 6660002,
      name: 'RT Bells Corners Blue Loop',
      route: 'hiking',
      bikeableWayIds: [6601],
      bikeablePct: 0.33, // below PROMOTE_THRESHOLD (0.9)
    };
    const out = await resolveClassificationPhase({
      entries,
      discovered: {
        osmRelations: [],
        osmNamedWays: [],
        parallelLanes: [],
        nonCyclingCandidates: [overlapCandidate],
        relationBaseNames: new Set(),
      },
      wayRegistry,
      ctx: {
        bbox: '45.2,-76.0,45.4,-75.6', adapter: ADAPTER,
        queryOverpass: async () => ({ elements: [] }),
        trace: trace.bind('resolve.classification'),
      },
    });
    // NOT promoted
    expect(out.find((e) => e.osm_relations?.includes(6660002))).toBeUndefined();
    // Overlap metadata attached to the cycling entry
    const greenbelt = out.find((e) => e.osm_relations?.includes(6660001));
    expect(greenbelt).toBeDefined();
    expect(greenbelt.overlapping_relations).toBeDefined();
    expect(greenbelt.overlapping_relations).toHaveLength(1);
    expect(greenbelt.overlapping_relations[0].name).toBe('RT Bells Corners Blue Loop');
    expect(greenbelt.overlapping_relations[0].route).toBe('hiking');
  });
});

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
});

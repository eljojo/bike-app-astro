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
});

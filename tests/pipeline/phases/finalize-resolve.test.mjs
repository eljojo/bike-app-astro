import { describe, it, expect } from 'vitest';
import { finalizeResolvePhase } from '../../../scripts/pipeline/phases/finalize-resolve.ts';
import { Trace } from '../../../scripts/pipeline/engine/trace.ts';
import { WayRegistry } from '../../../scripts/pipeline/lib/way-registry.mjs';

const ADAPTER = { relationNamePattern: '', namedWayQueries: () => [] };

describe('finalize.resolve phase', () => {
  it('computes slugs and returns entries + slugMap', async () => {
    const trace = new Trace();
    const wayRegistry = new WayRegistry();
    const entries = [
      { name: 'Alpha Trail', highway: 'cycleway' },
      { name: 'Beta Trail', highway: 'path' },
    ];
    const out = await finalizeResolvePhase({
      entries,
      superNetworks: [],
      wayRegistry,
      relationBaseNames: new Set(),
      ctx: {
        bbox: '0,0,1,1', adapter: ADAPTER,
        queryOverpass: async () => ({ elements: [] }),
        trace: trace.bind('finalize.resolve'),
      },
    });
    expect(out.entries).toHaveLength(2);
    expect(out.slugMap).toBeInstanceOf(Map);
    expect(out.slugMap.get(entries[0])).toBe('alpha-trail');
  });

  it('removes ghost entries (non-relation owned by relation entry)', async () => {
    const trace = new Trace();
    const wayRegistry = new WayRegistry();
    const relationEntry = { name: 'Real Trail', osm_relations: [100] };
    const ghost = { name: 'Real Trail Ghost' };
    wayRegistry.claim(relationEntry, [501, 502]);
    wayRegistry.claim(ghost, [501, 502]);
    const entries = [relationEntry, ghost];
    const out = await finalizeResolvePhase({
      entries,
      superNetworks: [],
      wayRegistry,
      relationBaseNames: new Set(),
      ctx: {
        bbox: '0,0,1,1', adapter: ADAPTER,
        queryOverpass: async () => ({ elements: [] }),
        trace: trace.bind('finalize.resolve'),
      },
    });
    expect(out.entries.find((e) => e.name === 'Real Trail Ghost')).toBeUndefined();
    expect(out.entries.find((e) => e.name === 'Real Trail')).toBeDefined();
  });

  // Regression for the Scott Street / East–West Crosstown Bikeway bug.
  // When the parallel-lane (non-relation) entry claims its ways BEFORE the
  // relation entry does, the way-registry maps each shared way to the parallel
  // entry. The current ghost-removal then checks `owner !== e` and finds the
  // owner IS the ghost itself, so it counts zero ways as "owned by others"
  // and keeps the ghost.
  it('removes ghost entries even when the ghost claims its ways first', async () => {
    const trace = new Trace();
    const wayRegistry = new WayRegistry();
    const ghost = { name: 'Scott Street', parallel_to: 'Scott Street', highway: 'cycleway', type: 'connector' };
    const relationEntry = { name: 'East–West Crosstown Bikeway', osm_relations: [7234399], type: 'destination' };
    // Ghost claims first — this is the failure mode.
    wayRegistry.claim(ghost, [501, 502, 503, 504]);
    wayRegistry.claim(relationEntry, [501, 502, 503, 504, 600, 601, 602]);
    const entries = [ghost, relationEntry];
    const out = await finalizeResolvePhase({
      entries,
      superNetworks: [],
      wayRegistry,
      relationBaseNames: new Set(),
      ctx: {
        bbox: '0,0,1,1', adapter: ADAPTER,
        queryOverpass: async () => ({ elements: [] }),
        trace: trace.bind('finalize.resolve'),
      },
    });
    expect(out.entries.find((e) => e.name === 'Scott Street')).toBeUndefined();
    expect(out.entries.find((e) => e.name === 'East–West Crosstown Bikeway')).toBeDefined();
  });

  // Regression matching the actual Ottawa numbers for Scott Street vs the
  // East–West Crosstown Bikeway: 70 parallel-lane ways, 146 relation ways, 51
  // shared. 73% of the parallel entry's ways are also in the relation, so it
  // is structurally a ghost regardless of claim order.
  it('removes ghost when 73% of its ways are in a relation entry (Scott Street numbers)', async () => {
    const trace = new Trace();
    const wayRegistry = new WayRegistry();
    const ghost = { name: 'Scott Street', parallel_to: 'Scott Street', type: 'connector' };
    const relationEntry = { name: 'East–West Crosstown Bikeway', osm_relations: [7234399] };

    const sharedWays = Array.from({ length: 51 }, (_, i) => 1000 + i);
    const ghostOnlyWays = Array.from({ length: 19 }, (_, i) => 2000 + i);
    const relationOnlyWays = Array.from({ length: 95 }, (_, i) => 3000 + i);

    // Ghost claims first — same failure mode as the live pipeline order.
    wayRegistry.claim(ghost, [...sharedWays, ...ghostOnlyWays]);
    wayRegistry.claim(relationEntry, [...sharedWays, ...relationOnlyWays]);

    const out = await finalizeResolvePhase({
      entries: [ghost, relationEntry],
      superNetworks: [],
      wayRegistry,
      relationBaseNames: new Set(),
      ctx: {
        bbox: '0,0,1,1', adapter: ADAPTER,
        queryOverpass: async () => ({ elements: [] }),
        trace: trace.bind('finalize.resolve'),
      },
    });

    expect(out.entries.find((e) => e.name === 'Scott Street')).toBeUndefined();
    expect(out.entries.find((e) => e.name === 'East–West Crosstown Bikeway')).toBeDefined();
  });
});

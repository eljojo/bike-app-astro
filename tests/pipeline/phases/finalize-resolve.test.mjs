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
});

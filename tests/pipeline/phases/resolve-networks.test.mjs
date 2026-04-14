import { describe, it, expect } from 'vitest';
import { resolveNetworksPhase } from '../../../scripts/pipeline/phases/resolve-networks.ts';
import { Trace } from '../../../scripts/pipeline/engine/trace.ts';
import { WayRegistry } from '../../../scripts/pipeline/lib/way-registry.mjs';

const ADAPTER = { relationNamePattern: '', namedWayQueries: () => [], discoverNetworks: false };

describe('resolve.networks phase', () => {
  it('passes entries through unchanged when no superroute discovery is enabled', async () => {
    const trace = new Trace();
    const wayRegistry = new WayRegistry();
    const entries = [{ name: 'Trail A' }];
    const result = await resolveNetworksPhase({
      entries,
      discovered: { osmRelations: [], osmNamedWays: [], parallelLanes: [], nonCyclingCandidates: [], relationBaseNames: new Set() },
      wayRegistry,
      ctx: {
        bbox: '0,0,1,1', adapter: ADAPTER,
        queryOverpass: async () => ({ elements: [] }),
        trace: trace.bind('resolve.networks'),
      },
    });
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].name).toBe('Trail A');
    expect(result.superNetworks).toEqual([]);
  });

  it('returns the entries array even when discoverNetworks is true (no networks discovered)', async () => {
    const trace = new Trace();
    const wayRegistry = new WayRegistry();
    const adapter = { ...ADAPTER, discoverNetworks: true };
    const result = await resolveNetworksPhase({
      entries: [{ name: 'Trail B' }],
      discovered: { osmRelations: [], osmNamedWays: [], parallelLanes: [], nonCyclingCandidates: [], relationBaseNames: new Set() },
      wayRegistry,
      ctx: {
        bbox: '0,0,1,1', adapter,
        queryOverpass: async () => ({ elements: [] }),
        trace: trace.bind('resolve.networks'),
      },
    });
    expect(result.entries).toHaveLength(1);
    expect(result.superNetworks).toEqual([]);
  });
});

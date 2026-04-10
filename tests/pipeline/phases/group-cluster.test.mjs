import { describe, it, expect } from 'vitest';
import { groupClusterPhase } from '../../../scripts/pipeline/phases/group-cluster.ts';
import { Trace } from '../../../scripts/pipeline/engine/trace.mjs';
import { WayRegistry } from '../../../scripts/pipeline/lib/way-registry.mjs';

const ADAPTER = { relationNamePattern: '', namedWayQueries: () => [] };

describe('group.cluster phase', () => {
  it('returns input entries unchanged when there are no candidates to cluster', async () => {
    const trace = new Trace();
    const wayRegistry = new WayRegistry();
    const entries = [];
    const out = await groupClusterPhase({
      entries,
      markdownSlugs: new Set(),
      wayRegistry,
      ctx: {
        bbox: '0,0,1,1',
        adapter: ADAPTER,
        queryOverpass: async () => ({ elements: [] }),
        trace: trace.bind('group.cluster'),
      },
    });
    expect(out).toEqual([]);
  });

  it('passes entries through autoGroupNearbyPaths', async () => {
    // A single trail entry — autoGroup needs at least 2 candidates to cluster
    const entries = [{
      name: 'Lonely Trail',
      _ways: [[{ lat: 45.5, lon: -75.7 }, { lat: 45.51, lon: -75.71 }]],
      anchors: [[-75.7, 45.5]],
      highway: 'path',
    }];
    const trace = new Trace();
    const wayRegistry = new WayRegistry();
    const out = await groupClusterPhase({
      entries,
      markdownSlugs: new Set(),
      wayRegistry,
      ctx: {
        bbox: '0,0,1,1',
        adapter: ADAPTER,
        queryOverpass: async () => ({ elements: [] }),
        trace: trace.bind('group.cluster'),
      },
    });
    // Single candidate → no cluster formed → entries returned unchanged
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('Lonely Trail');
  });
});

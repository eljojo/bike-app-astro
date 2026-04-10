import { describe, it, expect } from 'vitest';
import { discoverParallelLanesPhase } from '../../../scripts/pipeline/phases/discover-parallel-lanes.ts';
import { Trace } from '../../../scripts/pipeline/engine/trace.mjs';

const ADAPTER = {
  relationNamePattern: '',
  namedWayQueries: () => [],
  parallelLaneFilter: null,
};

describe('discover.parallelLanes phase', () => {
  it('returns empty when no unnamed cycleways are present', async () => {
    const trace = new Trace();
    const out = await discoverParallelLanesPhase({
      ctx: {
        bbox: '0,0,1,1',
        adapter: ADAPTER,
        queryOverpass: async () => ({ elements: [] }),
        trace: trace.bind('discover.parallelLanes'),
      },
    });
    expect(out).toEqual([]);
  });

  it('discovers a parallel lane and traces the road match', async () => {
    const SEGMENT = {
      type: 'way', id: 999001,
      center: { lat: 45.43, lon: -75.65 },
      tags: { highway: 'cycleway', surface: 'asphalt', width: '1.5' },
    };
    const ROAD = {
      type: 'way', id: 888001,
      tags: { highway: 'secondary', name: 'McArthur Avenue' },
      center: { lat: 45.4321, lon: -75.6524 },
    };
    const queryOverpass = async (q) => {
      if (q.includes('highway"="cycleway"][!"name"]')) return { elements: [SEGMENT] };
      if (q.includes('around:30')) return { elements: [ROAD] };
      return { elements: [] };
    };
    const trace = new Trace();
    const out = await discoverParallelLanesPhase({
      ctx: {
        bbox: '0,0,1,1',
        adapter: ADAPTER,
        queryOverpass,
        trace: trace.bind('discover.parallelLanes'),
      },
    });
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('McArthur Avenue');
  });

  it('picks McArthur Avenue over Irwin Miller Street when both roads are near the chain', async () => {
    // Regression: Overpass returns both roads with no class ordering.
    // selectBestRoad must pick the higher-class secondary road over
    // residential Irwin Miller. And no Irwin Miller entry should appear.
    const CYCLEWAY_SEGMENT = {
      type: 'way', id: 999001,
      center: { lat: 45.4319, lon: -75.6526 },
      tags: { highway: 'cycleway', surface: 'asphalt', width: '1.5' },
    };
    const ROADS_NEAR_INTERSECTION = [
      {
        type: 'way', id: 888001,
        tags: { highway: 'residential', name: 'Irwin Miller Street' },
        center: { lat: 45.43195, lon: -75.65258 },
      },
      {
        type: 'way', id: 888002,
        tags: { highway: 'secondary', name: 'McArthur Avenue' },
        center: { lat: 45.43210, lon: -75.65240 },
      },
    ];
    const queryOverpass = async (q) => {
      if (q.includes('highway"="cycleway"][!"name"]')) return { elements: [CYCLEWAY_SEGMENT] };
      if (q.includes('around:30')) return { elements: ROADS_NEAR_INTERSECTION };
      return { elements: [] };
    };
    const trace = new Trace();
    const out = await discoverParallelLanesPhase({
      ctx: {
        bbox: '45.15,-76.35,45.65,-75.35',
        adapter: ADAPTER,
        queryOverpass,
        trace: trace.bind('discover.parallelLanes'),
      },
    });
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('McArthur Avenue');
    expect(out[0].parallel_to).toBe('McArthur Avenue');
    // Irwin Miller must NOT become a candidate
    expect(out.find((e) => e.name === 'Irwin Miller Street')).toBeUndefined();
    // Trace records the road pairing
    expect(trace.subject('way:999001').events.map((e) => e.kind)).toContain('paired');
  });
});

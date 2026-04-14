import { describe, it, expect } from 'vitest';
import { discoverNonCyclingPhase } from '../../../scripts/pipeline/phases/discover-non-cycling.ts';
import { Trace } from '../../../scripts/pipeline/engine/trace.ts';

const ADAPTER = { relationNamePattern: '', namedWayQueries: () => [] };

describe('discover.nonCycling phase', () => {
  it('returns empty when no cycling way IDs are provided', async () => {
    const trace = new Trace();
    const out = await discoverNonCyclingPhase({
      relations: [],
      namedWays: [],
      ctx: {
        bbox: '0,0,1,1', adapter: ADAPTER,
        queryOverpass: async () => ({ elements: [] }),
        trace: trace.bind('discover.nonCycling'),
      },
    });
    expect(out).toEqual([]);
  });

  it('discovers a hiking relation that shares ways with cycling infrastructure', async () => {
    const HIKING_RELATION = {
      type: 'relation', id: 9990002,
      tags: { name: 'Rideau Trail', route: 'hiking', type: 'route', operator: 'RTA' },
      members: [
        { type: 'way', ref: 5501, role: '' },
        { type: 'way', ref: 5502, role: '' },
      ],
    };
    const queryOverpass = async (q) => {
      if (q.includes('rel(bw)')) return { elements: [HIKING_RELATION] };
      if (q.includes('out body')) return { elements: [HIKING_RELATION] };
      return { elements: [] };
    };
    const trace = new Trace();
    const out = await discoverNonCyclingPhase({
      relations: [],
      namedWays: [
        { name: 'Trail 25', wayCount: 2, _wayIds: [5501, 5502], anchors: [], osmNames: ['Trail 25'], tags: {} },
      ],
      ctx: {
        bbox: '0,0,1,1', adapter: ADAPTER, queryOverpass,
        trace: trace.bind('discover.nonCycling'),
      },
    });
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe(9990002);
    expect(out[0].name).toBe('Rideau Trail');
    expect(out[0].route).toBe('hiking');
    expect(out[0].bikeablePct).toBeCloseTo(1.0);
  });
});

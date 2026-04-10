import { describe, it, expect } from 'vitest';
import { discoverUnnamedChainsPhase } from '../../../scripts/pipeline/phases/discover-unnamed-chains.ts';
import { Trace } from '../../../scripts/pipeline/engine/trace.mjs';

const ADAPTER = { relationNamePattern: '', namedWayQueries: () => [] };

describe('discover.unnamedChains phase', () => {
  it('returns an empty array when no unnamed cycling ways are present', async () => {
    const trace = new Trace();
    const out = await discoverUnnamedChainsPhase({
      ctx: {
        bbox: '0,0,1,1',
        adapter: ADAPTER,
        queryOverpass: async () => ({ elements: [] }),
        trace: trace.bind('discover.unnamedChains'),
      },
    });
    expect(out).toEqual([]);
  });

  it('returns a chain named after a containing park, with _wayIds populated', async () => {
    const WAYS = [
      {
        type: 'way', id: 27806926,
        tags: { highway: 'path', bicycle: 'yes', surface: 'asphalt' },
        geometry: [
          { lat: 45.328, lon: -75.930 }, { lat: 45.329, lon: -75.928 },
          { lat: 45.330, lon: -75.926 }, { lat: 45.331, lon: -75.924 },
          { lat: 45.332, lon: -75.922 }, { lat: 45.333, lon: -75.920 },
        ],
        nodes: [100, 101, 102, 103, 104, 105],
      },
      {
        type: 'way', id: 80207516,
        tags: { highway: 'path', bicycle: 'yes', surface: 'asphalt' },
        geometry: [
          { lat: 45.333, lon: -75.920 }, { lat: 45.334, lon: -75.918 },
          { lat: 45.335, lon: -75.916 }, { lat: 45.336, lon: -75.914 },
          { lat: 45.337, lon: -75.912 },
        ],
        nodes: [105, 106, 107, 108, 109],
      },
    ];
    const queryOverpass = async (q) => {
      if (q.includes('bicycle"~"designated|yes"][!"name"]')) return { elements: WAYS };
      if (q.includes('is_in')) return { elements: [{ type: 'area', id: 999, tags: { name: 'Beauclaire Park', leisure: 'park' } }] };
      return { elements: [] };
    };
    const trace = new Trace();
    const out = await discoverUnnamedChainsPhase({
      ctx: {
        bbox: '45.15,-76.35,45.65,-75.35',
        adapter: ADAPTER,
        queryOverpass,
        trace: trace.bind('discover.unnamedChains'),
      },
    });
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('Beauclaire Park');
    expect(out[0]._wayIds).toContain(27806926);
    expect(out[0]._wayIds).toContain(80207516);
    expect(out[0]._isUnnamedChain).toBe(true);
    // osm_names should include the containing park (from is_in lookup)
    expect(out[0].osmNames).toContain('Beauclaire Park');
    // CRITICAL: chains must expose _wayIds so the assembly step can create
    // osm_way_ids on the entry. Without way IDs, name-based geo cache
    // lookups would match the park boundary (leisure=park) instead of the
    // underlying cycling ways.
    expect(out[0]._wayIds.length).toBeGreaterThan(0);
  });
});

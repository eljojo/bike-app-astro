import { describe, it, expect } from 'vitest';
import { discoverNamedWaysPhase } from '../../../scripts/pipeline/phases/discover-named-ways.ts';
import { Trace } from '../../../scripts/pipeline/engine/trace.mjs';

const ADAPTER = {
  relationNamePattern: '[Pp]athway|[Tt]rail|[Cc]ycl',
  namedWayQueries: (bbox) => [
    {
      label: 'bike paths',
      q: `[out:json];way["highway"="path"]["bicycle"~"designated|yes"]["name"](${bbox});out geom tags;`,
    },
  ],
};

function makeFixtureOverpass(responses) {
  return async (query) => {
    for (const [pattern, data] of responses) {
      if (query.includes(pattern)) return data;
    }
    return { elements: [] };
  };
}

describe('discover.namedWays phase', () => {
  it('runs adapter queries in parallel and builds clusters', async () => {
    const TRAIL_3 = {
      type: 'way', id: 636602417,
      tags: {
        highway: 'path',
        name: 'Trail #3',
        bicycle: 'designated',
        'mtb:scale': '2',
        'piste:type': 'nordic',
      },
      geometry: [{ lat: 45.55, lon: -75.90 }, { lat: 45.56, lon: -75.89 }],
      nodes: [9001, 9002],
    };
    const queryOverpass = makeFixtureOverpass([
      ['highway"="path"]["bicycle"', { elements: [TRAIL_3] }],
    ]);
    const trace = new Trace();
    const out = await discoverNamedWaysPhase({
      ctx: {
        bbox: '45.4,-76.1,45.7,-75.5',
        adapter: ADAPTER,
        queryOverpass,
        trace: trace.bind('discover.namedWays'),
      },
    });
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('Trail #3');
    expect(out[0]._wayIds).toEqual([636602417]);
    expect(trace.subject('way:636602417').events.map((e) => e.kind)).toContain('discovered');
  });

  it('filters ski-only ways from named-way ingestion (Piste 12 regression)', async () => {
    // Way with piste:type=nordic and no bicycle tag — should be filtered
    const PISTE_12 = {
      type: 'way', id: 278992292,
      tags: {
        highway: 'path',
        name: 'Piste 12',
        'piste:type': 'nordic',
      },
      geometry: [{ lat: 45.56, lon: -75.89 }, { lat: 45.57, lon: -75.88 }],
      nodes: [9002, 9003],
    };
    // Loose adapter that fetches without bicycle filter (so the phase has to filter)
    const looseAdapter = {
      ...ADAPTER,
      namedWayQueries: (bbox) => [
        { label: 'loose', q: `[out:json];way["highway"="path"]["name"](${bbox});out geom tags;` },
      ],
    };
    const queryOverpass = makeFixtureOverpass([
      ['highway"="path"]["name"', { elements: [PISTE_12] }],
    ]);
    const trace = new Trace();
    const out = await discoverNamedWaysPhase({
      ctx: {
        bbox: '45.4,-76.1,45.7,-75.5',
        adapter: looseAdapter,
        queryOverpass,
        trace: trace.bind('discover.namedWays'),
      },
    });
    expect(out.find((e) => e.name === 'Piste 12')).toBeUndefined();
    expect(trace.subject('way:278992292').events.map((e) => e.kind)).toContain('filtered');
  });

  it('produces deterministic ordering across runs (parallelism-safe)', async () => {
    // Same input, twice, should produce identical output ordering.
    // Promise.all preserves input array order in its output, so the parallel
    // adapter-query fetch yields the same order as the legacy sequential push
    // loop. The phase preserves that order through to osmNamedWays so the
    // Ottawa cassette (which keys queries by joined-ID string) keeps working.
    const WAYS = [
      { type: 'way', id: 1, tags: { highway: 'path', bicycle: 'designated', name: 'Zebra' }, geometry: [{lat: 1, lon: 1}, {lat: 1, lon: 2}], nodes: [10, 11] },
      { type: 'way', id: 2, tags: { highway: 'path', bicycle: 'designated', name: 'Alpha' }, geometry: [{lat: 2, lon: 1}, {lat: 2, lon: 2}], nodes: [20, 21] },
    ];
    const queryOverpass = makeFixtureOverpass([
      ['highway"="path"]["bicycle"', { elements: WAYS }],
    ]);
    const ctx = (trace) => ({
      bbox: '0,0,10,10', adapter: ADAPTER, queryOverpass, trace: trace.bind('discover.namedWays'),
    });
    const a = await discoverNamedWaysPhase({ ctx: ctx(new Trace()) });
    const b = await discoverNamedWaysPhase({ ctx: ctx(new Trace()) });
    expect(a.map((e) => e.name)).toEqual(b.map((e) => e.name));
    // Order matches input order (Zebra before Alpha) — preserves the legacy
    // sequential push order so cluster-building stays cassette-stable.
    expect(a.map((e) => e.name)).toEqual(['Zebra', 'Alpha']);
  });
});

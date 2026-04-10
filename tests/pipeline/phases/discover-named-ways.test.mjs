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

  it('filters a ski-only named way with bicycle=no at ingestion (Trail 18 regression)', async () => {
    // Parc de la Gatineau Trail 18 (OSM way 278785839) is
    // highway=path bicycle=no piste:type=nordic. Even if a future adapter
    // query is looser and returns it, the ingestion filter must drop it.
    const TRAIL_18 = {
      type: 'way', id: 278785839,
      tags: {
        highway: 'path',
        name: 'Trail 18',
        bicycle: 'no',
        'piste:type': 'nordic',
      },
      geometry: [{ lat: 45.58, lon: -75.85 }, { lat: 45.59, lon: -75.84 }],
      nodes: [9100, 9101],
    };
    const looseAdapter = {
      ...ADAPTER,
      namedWayQueries: (bbox) => [
        { label: 'loose paths', q: `[out:json];way["highway"="path"]["name"](${bbox});out geom tags;` },
      ],
    };
    const queryOverpass = makeFixtureOverpass([
      ['highway"="path"]["name"', { elements: [TRAIL_18] }],
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
    expect(out.find((e) => e.name === 'Trail 18')).toBeUndefined();
    expect(trace.subject('way:278785839').events.map((e) => e.kind)).toContain('filtered');
  });

  it('does not promote ski-only junction-way clusters via node(w)/way(bn) (Piste 12 junction regression)', async () => {
    // Junction-node discovery: Trail #3 is a real dual-use MTB/piste trail,
    // and it shares node 9002 with Piste 12 (a Nordic ski trail with no
    // bicycle tag). The junction fan-out query picks Piste 12 up via
    // way(bn), but the phase must NOT promote clusters where every way is
    // ski-only, even when discovered through that path.
    const TRAIL3 = {
      type: 'way', id: 636602417,
      tags: {
        highway: 'path',
        name: 'Trail #3',
        bicycle: 'designated',
        foot: 'designated',
        'mtb:scale': '2',
        'piste:type': 'nordic',
        surface: 'gravel',
      },
      geometry: [{ lat: 45.55, lon: -75.90 }, { lat: 45.56, lon: -75.89 }],
      nodes: [9001, 9002],
    };
    const PISTE12 = {
      type: 'way', id: 278992292,
      tags: {
        highway: 'path',
        name: 'Piste 12',
        'piste:type': 'nordic',
        'piste:name': '12',
        'piste:difficulty': 'intermediate',
        'piste:grooming': 'backcountry',
      },
      geometry: [{ lat: 45.56, lon: -75.89 }, { lat: 45.57, lon: -75.88 }],
      nodes: [9002, 9003], // shares node 9002 with Trail #3
    };
    const adapter = {
      ...ADAPTER,
      namedWayQueries: (bbox) => [
        {
          label: 'bike paths',
          q: `[out:json];way["highway"="path"]["bicycle"~"designated|yes"]["name"](${bbox});out geom tags;`,
        },
      ],
    };
    // Route queries by substring:
    // - ["bicycle"~"designated|yes"] → initial named-way query returns Trail #3
    // - way(bn) → junction query returns the ski-only Piste 12
    const queryOverpass = makeFixtureOverpass([
      ['["bicycle"~"designated|yes"]', { elements: [TRAIL3] }],
      ['way(bn)', { elements: [PISTE12] }],
    ]);
    const trace = new Trace();
    const out = await discoverNamedWaysPhase({
      ctx: {
        bbox: '45.4,-76.1,45.7,-75.5',
        adapter,
        queryOverpass,
        trace: trace.bind('discover.namedWays'),
      },
    });
    // Trail #3 must survive as a real dual-use trail
    expect(out.find((e) => e.name === 'Trail #3')).toBeDefined();
    // Piste 12 junction cluster must NOT become an entry
    expect(out.find((e) => e.name === 'Piste 12')).toBeUndefined();
    // Trace records the all-cluster ski filter reason
    const piste12Events = trace.subject('way:278992292').events;
    expect(piste12Events.map((e) => e.kind)).toContain('filtered');
    expect(piste12Events.find((e) => e.kind === 'filtered')?.data?.reason).toBe('all-cluster-ski-only');
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

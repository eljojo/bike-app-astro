import { describe, it, expect, beforeEach } from 'vitest';
import { discoverRelationsPhase } from '../../../scripts/pipeline/phases/discover-relations.ts';
import { Trace } from '../../../scripts/pipeline/engine/trace.mjs';

const OTTAWA_ADAPTER = {
  relationNamePattern: '[Pp]athway|[Tt]rail|[Cc]ycl|[Bb]ike|[Ss]entier|MUP|[Pp]iste',
  namedWayQueries: () => [],
};

function makeFixtureOverpass(responses) {
  return async (query) => {
    for (const [pattern, data] of responses) {
      if (query.includes(pattern)) return data;
    }
    return { elements: [] };
  };
}

describe('discover.relations phase', () => {
  it('returns the empty list when no relations match the bbox', async () => {
    const trace = new Trace();
    const out = await discoverRelationsPhase({
      ctx: {
        bbox: '0,0,1,1',
        adapter: OTTAWA_ADAPTER,
        queryOverpass: async () => ({ elements: [] }),
        trace: trace.bind('discover.relations'),
      },
    });
    expect(out).toEqual([]);
  });

  it('discovers a cycling relation, fetches its body, aggregates way tags, and traces each step', async () => {
    const RELATION = {
      type: 'relation', id: 12345,
      tags: { name: 'Test Trail', route: 'bicycle', type: 'route', network: 'lcn' },
    };
    const MEMBER_WAYS = [
      { type: 'way', id: 7001, tags: { highway: 'cycleway', surface: 'asphalt' } },
      { type: 'way', id: 7002, tags: { highway: 'cycleway', surface: 'asphalt' } },
    ];
    const queryOverpass = makeFixtureOverpass([
      ['relation["route"="bicycle"]', { elements: [RELATION] }],
      ['out body', { elements: [{ type: 'relation', id: 12345, members: [
        { type: 'way', ref: 7001, role: '' },
        { type: 'way', ref: 7002, role: '' },
      ] }] }],
      ['way(id:', { elements: MEMBER_WAYS }],
    ]);

    const trace = new Trace();
    const out = await discoverRelationsPhase({
      ctx: {
        bbox: '0,0,1,1',
        adapter: OTTAWA_ADAPTER,
        queryOverpass,
        trace: trace.bind('discover.relations'),
      },
    });

    expect(out).toHaveLength(1);
    expect(out[0].id).toBe(12345);
    expect(out[0].name).toBe('Test Trail');
    expect(out[0]._memberWayIds).toEqual([7001, 7002]);
    expect(out[0]._aggregatedWayTags).toBeDefined();
    expect(out[0]._aggregatedWayTags.highway).toBe('cycleway');

    // Trace assertions
    const events = trace.subject('relation:12345').events;
    expect(events.map((e) => e.kind)).toContain('discovered');
    expect(events.map((e) => e.kind)).toContain('enriched');
  });

  it('discovers route=mtb relations alongside route=bicycle', async () => {
    // Adapter queries `relation["route"="mtb"]` via a separate Overpass clause;
    // the phase combines them with route=bicycle into a single osmRelations array.
    const MTB_RELATION = {
      type: 'relation', id: 7770001,
      tags: { name: 'South March Highlands MTB', route: 'mtb', type: 'route', network: 'lcn' },
    };
    const queryOverpass = makeFixtureOverpass([
      // The phase issues ONE query that contains both route=bicycle and route=mtb
      // clauses. The mock matches on the first substring — 'route"="bicycle"' —
      // and returns the MTB relation, which then passes the CYCLING_ROUTES filter.
      ['relation["route"="bicycle"]', { elements: [MTB_RELATION] }],
      ['out body', { elements: [{ type: 'relation', id: 7770001, members: [
        { type: 'way', ref: 8880001, role: '' },
      ] }] }],
    ]);
    const trace = new Trace();
    const out = await discoverRelationsPhase({
      ctx: {
        bbox: '45.15,-76.35,45.65,-75.35',
        adapter: OTTAWA_ADAPTER,
        queryOverpass,
        trace: trace.bind('discover.relations'),
      },
    });
    const mtb = out.find((r) => r.id === 7770001);
    expect(mtb).toBeDefined();
    expect(mtb.name).toBe('South March Highlands MTB');
    expect(mtb.tags.route).toBe('mtb');
    expect(trace.subject('relation:7770001').events.map((e) => e.kind)).toContain('discovered');
  });

  it('aggregates way-level tags into a relation entry that lacks physical characteristics', async () => {
    // East–West Crosstown Bikeway regression: the relation only has route-level
    // tags (name, network, ref). Its member ways are mostly highway=cycleway +
    // surface=asphalt. discover.relations must aggregate the way tags into
    // `_aggregatedWayTags` so downstream phases can promote cycleway/asphalt
    // onto the entry (otherwise derivePathType falls back to `trail`).
    const RELATION = {
      type: 'relation', id: 7234399,
      tags: {
        name: 'East–West Crosstown Bikeway', route: 'bicycle', type: 'route',
        network: 'lcn', operator: 'City of Ottawa', ref: '2',
      },
    };
    const MEMBER_WAYS = [
      { type: 'way', id: 1001, tags: { highway: 'cycleway', surface: 'asphalt', width: '3', bicycle: 'designated' } },
      { type: 'way', id: 1002, tags: { highway: 'cycleway', surface: 'asphalt', width: '2.5' } },
      { type: 'way', id: 1003, tags: { highway: 'cycleway', surface: 'asphalt', lit: 'yes' } },
      { type: 'way', id: 1004, tags: { highway: 'cycleway', surface: 'asphalt' } },
      { type: 'way', id: 1005, tags: { highway: 'path', surface: 'asphalt', bicycle: 'designated', foot: 'designated' } },
    ];
    const memberRefs = MEMBER_WAYS.map((w) => ({ type: 'way', ref: w.id, role: '' }));
    const queryOverpass = makeFixtureOverpass([
      ['relation["route"="bicycle"]', { elements: [RELATION] }],
      ['out body', { elements: [{ type: 'relation', id: 7234399, members: memberRefs }] }],
      ['way(id:', { elements: MEMBER_WAYS }],
    ]);
    const trace = new Trace();
    const out = await discoverRelationsPhase({
      ctx: {
        bbox: '45.15,-76.35,45.65,-75.35',
        adapter: OTTAWA_ADAPTER,
        queryOverpass,
        trace: trace.bind('discover.relations'),
      },
    });
    expect(out).toHaveLength(1);
    const bikeway = out[0];
    expect(bikeway._memberWayIds).toEqual([1001, 1002, 1003, 1004, 1005]);
    expect(bikeway._aggregatedWayTags).toBeDefined();
    // Majority highway + surface must come through
    expect(bikeway._aggregatedWayTags.highway).toBe('cycleway');
    expect(bikeway._aggregatedWayTags.surface).toBe('asphalt');
    expect(trace.subject('relation:7234399').events.map((e) => e.kind)).toContain('enriched');
  });

  it('computes surface_mix km values that reflect actual way lengths, not way count', async () => {
    // Bug: the way-tag enrichment query used `out tags;` which omits
    // geometry. Without geometry, wayLengthKm() falls back to 1 km per way,
    // making surface_mix proportions reflect way count, not distance.
    //
    // The relation has a ~8 km asphalt way and a ~0.8 km gravel way. With
    // correct geometry, asphalt.km must be much larger than gravel.km.
    const RELATION = {
      type: 'relation', id: 5550001,
      tags: { name: 'Mixed Surface Trail', route: 'bicycle', type: 'route' },
    };
    // ~8 km asphalt (0.1° longitude at lat 45)
    const LONG_ASPHALT = {
      type: 'way', id: 4401,
      tags: { highway: 'cycleway', surface: 'asphalt' },
      geometry: [{ lat: 45.0, lon: -75.5 }, { lat: 45.0, lon: -75.4 }],
    };
    // ~0.8 km gravel (0.01° longitude)
    const SHORT_GRAVEL = {
      type: 'way', id: 4402,
      tags: { highway: 'cycleway', surface: 'gravel' },
      geometry: [{ lat: 45.0, lon: -75.4 }, { lat: 45.0, lon: -75.39 }],
    };
    const memberRefs = [
      { type: 'way', ref: 4401, role: '' },
      { type: 'way', ref: 4402, role: '' },
    ];
    // Format-aware mock: strips geometry from `out tags;` responses,
    // mirroring real Overpass behavior. The phase MUST use `out geom tags;`
    // for the aggregation query or lengths degrade to 1 km each.
    const queryOverpass = async (query) => {
      if (query.includes('relation["route"="bicycle"]')) return { elements: [RELATION] };
      if (query.includes('out body')) {
        return { elements: [{ type: 'relation', id: 5550001, members: memberRefs }] };
      }
      if (query.includes('way(id:')) {
        const ways = [LONG_ASPHALT, SHORT_GRAVEL];
        if (!query.includes('out geom')) {
          // Real Overpass: `out tags;` omits geometry
          return { elements: ways.map(({ geometry, ...rest }) => rest) };
        }
        return { elements: ways };
      }
      return { elements: [] };
    };
    const trace = new Trace();
    const out = await discoverRelationsPhase({
      ctx: {
        bbox: '44.5,-76.0,45.5,-75.0',
        adapter: OTTAWA_ADAPTER,
        queryOverpass,
        trace: trace.bind('discover.relations'),
      },
    });
    expect(out).toHaveLength(1);
    const mix = out[0]._aggregatedWayTags?.surface_mix;
    expect(mix, 'relation should have surface_mix from way-tag aggregation').toBeDefined();
    const asphalt = mix.find((m) => m.value === 'asphalt');
    const gravel = mix.find((m) => m.value === 'gravel');
    expect(asphalt).toBeDefined();
    expect(gravel).toBeDefined();
    // asphalt is ~10x longer than gravel — must come through as absolute km,
    // not 1 km fallback per way
    expect(
      asphalt.km,
      'surface_mix km must reflect actual way lengths',
    ).toBeGreaterThan(gravel.km * 3);
  });

  it('filters out non-cycling relations whose route tag is not bicycle/mtb', async () => {
    const PISTE_RELATION = {
      type: 'relation', id: 6871774,
      tags: { name: "Le P'tit Train du Nord", route: 'piste', type: 'route' },
    };
    const queryOverpass = makeFixtureOverpass([
      ['relation["route"="bicycle"]', { elements: [PISTE_RELATION] }],
    ]);
    const trace = new Trace();
    const out = await discoverRelationsPhase({
      ctx: {
        bbox: '0,0,1,1',
        adapter: OTTAWA_ADAPTER,
        queryOverpass,
        trace: trace.bind('discover.relations'),
      },
    });
    expect(out).toEqual([]);
    // Trace records the filter
    expect(trace.subject('relation:6871774').events.map((e) => e.kind)).toContain('filtered');
  });
});

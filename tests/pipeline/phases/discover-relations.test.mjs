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

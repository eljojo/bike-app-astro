import { describe, it, expect } from 'vitest';
import { buildBikepathsPipeline } from '../../scripts/pipeline/build-bikepaths.mjs';

// Fixture: a single unnamed cycleway segment near the McArthur/Irwin Miller
// intersection in Vanier. The road lookup returns both roads — the bug was
// that elements[0] (Irwin Miller, residential) was picked over McArthur
// (secondary) because Overpass doesn't order by road class.

const CYCLEWAY_SEGMENT = {
  type: 'way',
  id: 999001,
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

function makeFixtureOverpass(responses) {
  return async (query) => {
    for (const [pattern, data] of responses) {
      if (query.includes(pattern)) return data;
    }
    return { elements: [] };
  };
}

const OTTAWA_ADAPTER = {
  relationNamePattern: '[Pp]athway|[Tt]rail|[Cc]ycl|[Bb]ike|[Ss]entier|MUP|[Pp]iste',
  namedWayQueries: () => [],
  externalData: null,
  parallelLaneFilter: null,
};

describe('buildBikepathsPipeline', () => {
  it('picks McArthur Avenue over Irwin Miller Street for parallel lane', async () => {
    const queryOverpass = makeFixtureOverpass([
      // Relations query — empty
      ['relation["route"="bicycle"]', { elements: [] }],
      // Unnamed cycleways query — our single segment
      ['highway"="cycleway"][!"name"]', { elements: [CYCLEWAY_SEGMENT] }],
      // Road lookup near the chain midpoint — both roads
      ['around:30', { elements: ROADS_NEAR_INTERSECTION }],
    ]);

    const { entries: result } = await buildBikepathsPipeline({
      queryOverpass,
      bbox: '45.15,-76.35,45.65,-75.35',
      adapter: OTTAWA_ADAPTER,
      manualEntries: [],
    });

    const parallel = result.filter(e => e.parallel_to);
    expect(parallel).toHaveLength(1);
    expect(parallel[0].name).toBe('McArthur Avenue');
    expect(parallel[0].parallel_to).toBe('McArthur Avenue');
  });

  it('does not create Irwin Miller Street entry', async () => {
    const queryOverpass = makeFixtureOverpass([
      ['relation["route"="bicycle"]', { elements: [] }],
      ['highway"="cycleway"][!"name"]', { elements: [CYCLEWAY_SEGMENT] }],
      ['around:30', { elements: ROADS_NEAR_INTERSECTION }],
    ]);

    const { entries: result } = await buildBikepathsPipeline({
      queryOverpass,
      bbox: '45.15,-76.35,45.65,-75.35',
      adapter: OTTAWA_ADAPTER,
      manualEntries: [],
    });

    const irwin = result.filter(e => e.name === 'Irwin Miller Street');
    expect(irwin).toHaveLength(0);
  });

  it('does not create duplicate entry when named ways are inside a relation with different name', async () => {
    const RELATION = {
      type: 'relation', id: 1623089,
      tags: { name: 'Cycloparc PPJ', route: 'bicycle', type: 'route', network: 'lcn', ref: 'PPJ 1' },
    };
    const NAMED_WAYS = [
      {
        type: 'way', id: 501,
        tags: { highway: 'cycleway', name: 'PPJ Cycloparc', surface: 'fine_gravel' },
        geometry: [{ lat: 45.57, lon: -76.39 }, { lat: 45.56, lon: -76.38 }],
        nodes: [1001, 1002],
      },
      {
        type: 'way', id: 502,
        tags: { highway: 'cycleway', name: 'PPJ Cycloparc', surface: 'fine_gravel' },
        geometry: [{ lat: 45.56, lon: -76.38 }, { lat: 45.55, lon: -76.37 }],
        nodes: [1002, 1003],
      },
      {
        type: 'way', id: 503,
        tags: { highway: 'cycleway', name: 'Cycloparc PPJ', surface: 'asphalt' },
        geometry: [{ lat: 45.55, lon: -76.37 }, { lat: 45.54, lon: -76.36 }],
        nodes: [1003, 1004],
      },
    ];

    const adapterWithNamedWays = {
      ...OTTAWA_ADAPTER,
      namedWayQueries: (bbox) => [
        { label: 'cycleways', q: `[out:json][timeout:60];way["highway"="cycleway"]["name"](${bbox});out geom tags;` },
      ],
    };

    const queryOverpass = makeFixtureOverpass([
      ['relation["route"="bicycle"]', { elements: [RELATION] }],
      ['out body', { elements: [{ type: 'relation', id: 1623089, members: [
        { type: 'way', ref: 501, role: '' },
        { type: 'way', ref: 502, role: '' },
        { type: 'way', ref: 503, role: '' },
      ] }] }],
      ['highway"="cycleway"]["name"', { elements: NAMED_WAYS }],
      ['out geom', { elements: [{ type: 'relation', id: 1623089, members: NAMED_WAYS.map(w => ({
        type: 'way', ref: w.id, role: '', geometry: w.geometry,
      })) }] }],
    ]);

    const { entries } = await buildBikepathsPipeline({
      queryOverpass,
      bbox: '45.3,-76.6,45.7,-75.5',
      adapter: adapterWithNamedWays,
      manualEntries: [],
    });

    const cycloparc = entries.filter(e =>
      e.name.toLowerCase().includes('cycloparc') || e.name.toLowerCase().includes('ppj')
    );
    expect(cycloparc).toHaveLength(1);
    expect(cycloparc[0].osm_relations).toContain(1623089);
    expect(cycloparc[0].osm_way_ids).toEqual(expect.arrayContaining([501, 502, 503]));
  });

  it('merges parallel geometry into existing entry, keeping worse facts', async () => {
    // McArthur Avenue already exists as a named way with highway: secondary.
    // The parallel lane discovery finds a cycleway alongside it.
    // Result: parallel_to gets added, but highway stays "secondary" (worse).
    const existingMcArthur = {
      name: 'McArthur Avenue',
      osm_names: ['McArthur Avenue'],
      highway: 'secondary',
      cycleway: 'lane',
      surface: 'asphalt',
      anchors: [[-75.668, 45.430], [-75.642, 45.432]],
    };

    const queryOverpass = makeFixtureOverpass([
      ['relation["route"="bicycle"]', { elements: [] }],
      ['highway"="cycleway"][!"name"]', { elements: [CYCLEWAY_SEGMENT] }],
      ['around:30', { elements: ROADS_NEAR_INTERSECTION }],
    ]);

    const { entries: result } = await buildBikepathsPipeline({
      queryOverpass,
      bbox: '45.15,-76.35,45.65,-75.35',
      adapter: OTTAWA_ADAPTER,
      manualEntries: [existingMcArthur],
    });

    const mcarthur = result.find(e => e.name === 'McArthur Avenue');
    // parallel_to gets merged in for geometry resolution
    expect(mcarthur.parallel_to).toBe('McArthur Avenue');
    // keeps the road's worse facts, not the cycleway's
    expect(mcarthur.highway).toBe('secondary');
    expect(mcarthur.cycleway).toBe('lane');
    // only one entry, not two
    expect(result.filter(e => e.name === 'McArthur Avenue')).toHaveLength(1);
  });
});

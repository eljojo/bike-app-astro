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

  it('does not bleed way-level wikidata/wikipedia onto the relation entry', async () => {
    // Relation "Crosstown Bikeway 3" has no wikidata/wikipedia tags.
    // One of its member ways is the Adàwe Crossing bridge, which has
    // wikidata: Q48796246 and wikipedia: en:Adàwe Crossing.
    // The bridge's tags must NOT bleed up to the bikeway entry.
    const RELATION = {
      type: 'relation', id: 10985930,
      tags: { name: 'Crosstown Bikeway 3', route: 'bicycle', type: 'route',
              network: 'lcn', ref: '3', cycle_network: 'CA:ON:Ottawa' },
    };
    // The bridge way — has wikidata/wikipedia that should NOT propagate
    const BRIDGE_WAY = {
      type: 'way', id: 701,
      tags: {
        highway: 'cycleway', name: 'Crosstown Bikeway 3',
        surface: 'concrete', wikidata: 'Q48796246',
        wikipedia: 'en:Adàwe Crossing', 'name:en': 'Adàwe crossing',
        'name:fr': 'passerelle Adàwe',
      },
      geometry: [{ lat: 45.42, lon: -75.64 }, { lat: 45.43, lon: -75.63 }],
      nodes: [3001, 3002],
    };
    // A normal bikeway way — no wikidata
    const NORMAL_WAY = {
      type: 'way', id: 702,
      tags: { highway: 'cycleway', name: 'Crosstown Bikeway 3', surface: 'asphalt' },
      geometry: [{ lat: 45.43, lon: -75.63 }, { lat: 45.44, lon: -75.62 }],
      nodes: [3002, 3003],
    };

    const adapterWithWays = {
      ...OTTAWA_ADAPTER,
      namedWayQueries: (bbox) => [
        { label: 'cycleways', q: `[out:json];way["highway"="cycleway"]["name"](${bbox});out geom tags;` },
      ],
    };

    const queryOverpass = makeFixtureOverpass([
      ['relation["route"="bicycle"]', { elements: [RELATION] }],
      ['out body', { elements: [{ type: 'relation', id: 10985930, members: [
        { type: 'way', ref: 701, role: '' },
        { type: 'way', ref: 702, role: '' },
      ] }] }],
      ['highway"="cycleway"]["name"', { elements: [BRIDGE_WAY, NORMAL_WAY] }],
      ['out geom', { elements: [{ type: 'relation', id: 10985930, members: [
        { type: 'way', ref: 701, role: '', geometry: BRIDGE_WAY.geometry },
        { type: 'way', ref: 702, role: '', geometry: NORMAL_WAY.geometry },
      ] }] }],
    ]);

    const { entries } = await buildBikepathsPipeline({
      queryOverpass,
      bbox: '45.3,-76.0,45.5,-75.5',
      adapter: adapterWithWays,
      manualEntries: [],
    });

    const bikeway = entries.find(e => e.name === 'Crosstown Bikeway 3');
    expect(bikeway).toBeDefined();
    // The relation has no wikidata — bridge way's wikidata must not bleed up
    expect(bikeway.wikidata).toBeUndefined();
    expect(bikeway.wikipedia).toBeUndefined();
    // Bilingual names from bridge must not overwrite relation name
    expect(bikeway.name_en).toBeUndefined();
    expect(bikeway.name_fr).toBeUndefined();
  });

  it('discovers route=mtb relations', async () => {
    const MTB_RELATION = {
      type: 'relation', id: 7770001,
      tags: { name: 'South March Highlands MTB', route: 'mtb', type: 'route', network: 'lcn' },
    };
    const MTB_WAY = {
      type: 'way', id: 8880001,
      tags: { highway: 'path', mtb: 'yes', surface: 'ground' },
      geometry: [{ lat: 45.35, lon: -75.95 }, { lat: 45.36, lon: -75.94 }],
    };

    const queryOverpass = makeFixtureOverpass([
      // Relations query — matches on route=mtb substring
      ['route"="mtb"', { elements: [MTB_RELATION] }],
      // Also match the bicycle relation part (returns empty since we only have MTB)
      ['relation["route"="bicycle"]', { elements: [MTB_RELATION] }],
      // Body query for member way IDs
      ['out body', { elements: [{ type: 'relation', id: 7770001, members: [
        { type: 'way', ref: 8880001, role: '' },
      ] }] }],
      // Geom query for relation ways
      ['out geom', { elements: [{ type: 'relation', id: 7770001, members: [
        { type: 'way', ref: 8880001, role: '', geometry: MTB_WAY.geometry },
      ] }] }],
      // Unnamed cycleways — empty
      ['highway"="cycleway"][!"name"]', { elements: [] }],
      // Unnamed chains — empty
      ['bicycle"~"designated|yes"][!"name"]', { elements: [] }],
    ]);

    const { entries } = await buildBikepathsPipeline({
      queryOverpass,
      bbox: '45.15,-76.35,45.65,-75.35',
      adapter: OTTAWA_ADAPTER,
      manualEntries: [],
    });

    const mtb = entries.find(e => e.name === 'South March Highlands MTB');
    expect(mtb).toBeDefined();
    expect(mtb.osm_relations).toContain(7770001);
  });

  it('attaches hiking relation overlap metadata to cycling entries', async () => {
    const BIKE_RELATION = {
      type: 'relation', id: 9990001,
      tags: { name: 'Greenbelt Trail', route: 'bicycle', type: 'route' },
    };
    const HIKING_RELATION = {
      type: 'relation', id: 9990002,
      tags: { name: 'Rideau Trail - Ottawa', route: 'hiking', type: 'route',
              operator: 'Rideau Trail Association', ref: 'RTO' },
      members: [
        { type: 'way', ref: 5501, role: '' },
        { type: 'way', ref: 5502, role: '' },
      ],
    };
    const CYCLING_WAYS = [
      { type: 'way', id: 5501, tags: { highway: 'cycleway', name: 'Trail 25', surface: 'ground' },
        geometry: [{ lat: 45.3, lon: -75.8 }, { lat: 45.31, lon: -75.79 }], nodes: [1, 2] },
      { type: 'way', id: 5502, tags: { highway: 'path', name: 'Trail 25', surface: 'ground', bicycle: 'yes' },
        geometry: [{ lat: 45.31, lon: -75.79 }, { lat: 45.32, lon: -75.78 }], nodes: [2, 3] },
    ];

    const adapterWithWays = {
      ...OTTAWA_ADAPTER,
      namedWayQueries: (bbox) => [
        { label: 'cycleways', q: `[out:json];way["highway"="cycleway"]["name"](${bbox});out geom tags;` },
        { label: 'paths', q: `[out:json];way["highway"="path"]["bicycle"~"yes|designated"]["name"](${bbox});out geom tags;` },
      ],
    };

    const queryOverpass = makeFixtureOverpass([
      ['relation["route"="bicycle"]', { elements: [BIKE_RELATION] }],
      ['relation["route"="mtb"]', { elements: [] }],
      // Spider query (must come before 'out body' since it also contains that substring)
      ['route"!="bicycle"', { elements: [HIKING_RELATION] }],
      ['out body', { elements: [{ type: 'relation', id: 9990001, members: [
        { type: 'way', ref: 5501, role: '' },
        { type: 'way', ref: 5502, role: '' },
      ] }] }],
      ['highway"="cycleway"]["name"', { elements: [CYCLING_WAYS[0]] }],
      ['highway"="path"]["bicycle"', { elements: [CYCLING_WAYS[1]] }],
      ['out geom', { elements: [{ type: 'relation', id: 9990001, members: CYCLING_WAYS.map(w => ({
        type: 'way', ref: w.id, role: '', geometry: w.geometry,
      })) }] }],
    ]);

    const { entries } = await buildBikepathsPipeline({
      queryOverpass,
      bbox: '45.2,-76.0,45.4,-75.6',
      adapter: adapterWithWays,
      manualEntries: [],
    });

    // The hiking relation is 100% bikeable (2/2 ways) so it gets promoted
    // to a real entry, not attached as overlap metadata
    const promoted = entries.find(e => e.osm_relations?.includes(9990002));
    expect(promoted).toBeDefined();
    expect(promoted.name).toBe('Rideau Trail - Ottawa');
    expect(promoted.route_type).toBe('hiking');

    // The cycling entry should NOT have overlap metadata (relation was promoted)
    const cycling = entries.find(e => e.osm_relations?.includes(9990001));
    expect(cycling).toBeDefined();
    expect(cycling.overlapping_relations).toBeUndefined();
  });

  it('promotes a piste relation to a real entry when 100% of its ways are cycling infrastructure', async () => {
    // Le P'tit Train du Nord: tagged route=piste in OSM, but every single
    // way is highway=cycleway. The ways are the truth — this IS a bike path.
    // The piste tag is a fact about the entry, not its identity.
    const CYCLING_RELATION = {
      type: 'relation', id: 8880001,
      tags: { name: 'Trans Canada Trail', route: 'bicycle', type: 'route' },
    };
    const PISTE_RELATION = {
      type: 'relation', id: 8880002,
      tags: { name: "Le P'tit Train du Nord", route: 'piste', type: 'route' },
      members: [
        { type: 'way', ref: 7701, role: '' },
        { type: 'way', ref: 7702, role: '' },
        { type: 'way', ref: 7703, role: '' },
      ],
    };
    // All three ways are cycleways — discovered by the pipeline as cycling infrastructure
    const WAYS = [
      { type: 'way', id: 7701, tags: { highway: 'cycleway', name: "Le P'tit Train du Nord", surface: 'compacted', bicycle: 'designated' },
        geometry: [{ lat: 45.81, lon: -74.03 }, { lat: 45.82, lon: -74.04 }], nodes: [1, 2] },
      { type: 'way', id: 7702, tags: { highway: 'cycleway', name: "Le P'tit Train du Nord", surface: 'compacted', bicycle: 'designated' },
        geometry: [{ lat: 45.82, lon: -74.04 }, { lat: 45.83, lon: -74.05 }], nodes: [2, 3] },
      { type: 'way', id: 7703, tags: { highway: 'cycleway', name: "Le P'tit Train du Nord", surface: 'asphalt', bicycle: 'designated' },
        geometry: [{ lat: 45.83, lon: -74.05 }, { lat: 45.84, lon: -74.06 }], nodes: [3, 4] },
    ];

    const adapterWithWays = {
      ...OTTAWA_ADAPTER,
      namedWayQueries: (bbox) => [
        { label: 'cycleways', q: `[out:json];way["highway"="cycleway"]["name"](${bbox});out geom tags;` },
      ],
    };

    const queryOverpass = makeFixtureOverpass([
      ['relation["route"="bicycle"]', { elements: [CYCLING_RELATION] }],
      ['relation["route"="mtb"]', { elements: [] }],
      ['route"!="bicycle"', { elements: [PISTE_RELATION] }],
      // Body query for both relations
      ['out body', { elements: [
        { type: 'relation', id: 8880001, members: WAYS.map(w => ({ type: 'way', ref: w.id, role: '' })) },
        { type: 'relation', id: 8880002, members: WAYS.map(w => ({ type: 'way', ref: w.id, role: '' })) },
      ] }],
      ['highway"="cycleway"]["name"', { elements: WAYS }],
      ['out geom', { elements: [{ type: 'relation', id: 8880001, members: WAYS.map(w => ({
        type: 'way', ref: w.id, role: '', geometry: w.geometry,
      })) }] }],
    ]);

    const { entries } = await buildBikepathsPipeline({
      queryOverpass,
      bbox: '45.7,-74.2,45.9,-73.9',
      adapter: adapterWithWays,
      manualEntries: [],
    });

    // The piste relation should be promoted to a real entry
    const ptdn = entries.find(e => e.osm_relations?.includes(8880002));
    expect(ptdn).toBeDefined();
    expect(ptdn.name).toBe("Le P'tit Train du Nord");
    expect(ptdn.route_type).toBe('piste');
    expect(ptdn.slug).toBeDefined(); // slug was computed
    expect(ptdn.osm_way_ids).toEqual(expect.arrayContaining([7701, 7702, 7703]));
  });

  it('keeps low-bikeable relation as overlap metadata, does not promote', async () => {
    // RT Bells Corners Blue Loop: 43% bikeable. Should be overlap metadata,
    // not a promoted entry. Only the bikeable ways matter to us.
    const CYCLING_RELATION = {
      type: 'relation', id: 6660001,
      tags: { name: 'Greenbelt Pathway', route: 'bicycle', type: 'route' },
    };
    const HIKING_RELATION = {
      type: 'relation', id: 6660002,
      tags: { name: 'RT Bells Corners Blue Loop', route: 'hiking', type: 'route' },
      // 3 ways total, only 1 is cycling — 33%, below threshold
      members: [
        { type: 'way', ref: 6601, role: '' },
        { type: 'way', ref: 6602, role: '' },
        { type: 'way', ref: 6603, role: '' },
      ],
    };
    const CYCLING_WAY = {
      type: 'way', id: 6601, tags: { highway: 'cycleway', name: 'Greenbelt Pathway West', surface: 'asphalt', bicycle: 'designated' },
      geometry: [{ lat: 45.33, lon: -75.85 }, { lat: 45.34, lon: -75.84 }], nodes: [1, 2],
    };

    const adapterWithWays = {
      ...OTTAWA_ADAPTER,
      namedWayQueries: (bbox) => [
        { label: 'cycleways', q: `[out:json];way["highway"="cycleway"]["name"](${bbox});out geom tags;` },
      ],
    };

    const queryOverpass = makeFixtureOverpass([
      ['relation["route"="bicycle"]', { elements: [CYCLING_RELATION] }],
      ['relation["route"="mtb"]', { elements: [] }],
      ['route"!="bicycle"', { elements: [HIKING_RELATION] }],
      ['out body', { elements: [
        { type: 'relation', id: 6660001, members: [{ type: 'way', ref: 6601, role: '' }] },
        { type: 'relation', id: 6660002, members: [
          { type: 'way', ref: 6601, role: '' },
          { type: 'way', ref: 6602, role: '' },
          { type: 'way', ref: 6603, role: '' },
        ] },
      ] }],
      ['highway"="cycleway"]["name"', { elements: [CYCLING_WAY] }],
      ['out geom', { elements: [{ type: 'relation', id: 6660001, members: [
        { type: 'way', ref: 6601, role: '', geometry: CYCLING_WAY.geometry },
      ] }] }],
    ]);

    const { entries } = await buildBikepathsPipeline({
      queryOverpass,
      bbox: '45.2,-76.0,45.4,-75.6',
      adapter: adapterWithWays,
      manualEntries: [],
    });

    // The hiking relation should NOT be promoted (only 33% bikeable)
    const promoted = entries.find(e => e.osm_relations?.includes(6660002));
    expect(promoted).toBeUndefined();

    // The cycling entry should have overlap metadata instead
    const cycling = entries.find(e => e.osm_relations?.includes(6660001));
    expect(cycling).toBeDefined();
    expect(cycling.overlapping_relations).toBeDefined();
    expect(cycling.overlapping_relations).toHaveLength(1);
    expect(cycling.overlapping_relations[0].name).toBe('RT Bells Corners Blue Loop');
    expect(cycling.overlapping_relations[0].route).toBe('hiking');
  });
});

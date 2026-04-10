// tests/pipeline/build-bikepaths.test.mjs
//
// Cross-phase integration tests for the bikepaths pipeline.
//
// Most pipeline regression tests live alongside the phase they exercise in
// tests/pipeline/phases/*.test.mjs — they import the phase directly, build a
// tiny in-memory fixture, and assert on both the returned entries and the
// Trace events. The teaching pattern for new pipeline tests lives there.
//
// This file is reserved for tests that GENUINELY cross multiple phases. When
// adding a new test here, first ask: "can this be expressed as an assertion
// on a single phase's output?" If yes, put it in the phase test file.

import { describe, it, expect } from 'vitest';
import { buildBikepathsPipeline } from '../../scripts/pipeline/build-bikepaths.ts';

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

describe('buildBikepathsPipeline (cross-phase integration)', () => {
  it('promotes a high-bikeable hiking relation across discover.nonCycling + resolve.classification', async () => {
    // End-to-end integration: a hiking relation whose member ways are all
    // already discovered as cycling infrastructure. discover.nonCycling must
    // surface it as a candidate with bikeablePct=1.0, and
    // resolve.classification must promote it into a real entry with
    // route_type='hiking'. The cycling entry that owns the shared ways
    // must NOT end up with overlap metadata (because the relation was
    // promoted instead).
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

    // The hiking relation is 100% bikeable (2/2 ways) so it is promoted
    // to a real entry, not attached as overlap metadata.
    const promoted = entries.find(e => e.osm_relations?.includes(9990002));
    expect(promoted).toBeDefined();
    expect(promoted.name).toBe('Rideau Trail - Ottawa');
    expect(promoted.route_type).toBe('hiking');

    // The cycling entry should NOT have overlap metadata (relation was promoted)
    const cycling = entries.find(e => e.osm_relations?.includes(9990001));
    expect(cycling).toBeDefined();
    expect(cycling.overlapping_relations).toBeUndefined();
  });
});

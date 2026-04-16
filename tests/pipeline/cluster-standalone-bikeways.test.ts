import { describe, it, expect } from 'vitest';
import { clusterStandaloneBikewaysPhase, MIN_CLUSTER_MEMBERS, type BikewayClusterRegion } from '../../scripts/pipeline/phases/cluster-standalone-bikeways.ts';

const OTTAWA_SOUTH: BikewayClusterRegion = {
  name: 'Ottawa Bikeways', slug: 'ottawa-bikeways',
  latMin: 45.10, latMax: 45.45, lngMin: -76.40, lngMax: -75.40,
};
const GATINEAU_NORTH: BikewayClusterRegion = {
  name: 'Gatineau Bikeways', slug: 'gatineau-bikeways',
  latMin: 45.45, latMax: 45.70, lngMin: -76.10, lngMax: -75.40,
};

function mkStandalone(slug: string, pathType: string, lat: number, lng: number) {
  return { name: slug, path_type: pathType, type: 'infrastructure', anchors: [[lng, lat]] };
}
function mkNetwork(slug: string) {
  return { name: slug, type: 'network', _memberRefs: [] };
}

const nullCtx = { trace: () => {}, adapter: {}, queryOverpass: async () => ({ elements: [] }), bbox: '' } as any;

describe('clusterStandaloneBikewaysPhase', () => {
  it('returns input unchanged when no regions given', async () => {
    const entries = [mkStandalone('a', 'bike-lane', 45.5, -75.7)];
    const result = await clusterStandaloneBikewaysPhase({ entries, regions: [], ctx: nullCtx });
    expect(result).toEqual(entries);
  });

  it('clusters standalones in Gatineau into gatineau-bikeways', async () => {
    const entries = [
      mkStandalone('boul-de-la-gappe', 'bike-lane', 45.50, -75.65),
      mkStandalone('chemin-de-masson', 'bike-lane', 45.55, -75.60),
      mkStandalone('boul-cite-des-jeunes', 'bike-lane', 45.48, -75.70),
      mkStandalone('unrelated-ottawa-path', 'bike-lane', 45.40, -75.70), // Ottawa side
    ];
    const result = await clusterStandaloneBikewaysPhase({ entries, regions: [GATINEAU_NORTH], ctx: nullCtx });
    const net = result.find((e: any) => e.type === 'network' && e.name === 'Gatineau Bikeways');
    expect(net).toBeDefined();
    expect(net._memberRefs.map((m: any) => m.name)).toEqual([
      'boul-de-la-gappe', 'chemin-de-masson', 'boul-cite-des-jeunes',
    ]);
  });

  it(`skips regions with < ${MIN_CLUSTER_MEMBERS} members`, async () => {
    const entries = [
      mkStandalone('a', 'bike-lane', 45.50, -75.65),
      mkStandalone('b', 'bike-lane', 45.55, -75.60),
    ];
    const result = await clusterStandaloneBikewaysPhase({ entries, regions: [GATINEAU_NORTH], ctx: nullCtx });
    expect(result.find((e: any) => e.type === 'network' && e.name === 'Gatineau Bikeways')).toBeUndefined();
  });

  it('skips regions where an existing network with the same slug already exists', async () => {
    const existing = mkNetwork('Ottawa Bikeways');
    const entries = [
      existing,
      mkStandalone('a', 'bike-lane', 45.40, -75.70),
      mkStandalone('b', 'bike-lane', 45.35, -75.65),
      mkStandalone('c', 'bike-lane', 45.30, -75.60),
    ];
    const result = await clusterStandaloneBikewaysPhase({ entries, regions: [OTTAWA_SOUTH], ctx: nullCtx });
    // Only the original network exists; no duplicate was added.
    const ottawaNets = result.filter((e: any) => e.type === 'network' && e.name === 'Ottawa Bikeways');
    expect(ottawaNets).toHaveLength(1);
    expect(ottawaNets[0]).toBe(existing);
  });

  it('ignores standalones already in a network (member_of set)', async () => {
    const entries = [
      mkStandalone('a', 'bike-lane', 45.50, -75.65),
      mkStandalone('b', 'bike-lane', 45.55, -75.60),
      { ...mkStandalone('c', 'bike-lane', 45.52, -75.62), member_of: 'some-other-network' },
    ];
    const result = await clusterStandaloneBikewaysPhase({ entries, regions: [GATINEAU_NORTH], ctx: nullCtx });
    // Only 2 eligible members — below threshold — so no cluster emitted.
    expect(result.find((e: any) => e.type === 'network' && e.name === 'Gatineau Bikeways')).toBeUndefined();
  });

  it('ignores non-bikeway path_types (mup, trail, mtb-trail)', async () => {
    const entries = [
      mkStandalone('a', 'mup', 45.50, -75.65),
      mkStandalone('b', 'trail', 45.55, -75.60),
      mkStandalone('c', 'mtb-trail', 45.52, -75.62),
    ];
    const result = await clusterStandaloneBikewaysPhase({ entries, regions: [GATINEAU_NORTH], ctx: nullCtx });
    expect(result.find((e: any) => e.type === 'network' && e.name === 'Gatineau Bikeways')).toBeUndefined();
  });

  it('handles both separated-lane and paved-shoulder as bikeway path_types', async () => {
    const entries = [
      mkStandalone('a', 'bike-lane', 45.50, -75.65),
      mkStandalone('b', 'separated-lane', 45.55, -75.60),
      mkStandalone('c', 'paved-shoulder', 45.52, -75.62),
    ];
    const result = await clusterStandaloneBikewaysPhase({ entries, regions: [GATINEAU_NORTH], ctx: nullCtx });
    const net = result.find((e: any) => e.type === 'network' && e.name === 'Gatineau Bikeways');
    expect(net).toBeDefined();
    expect(net._memberRefs).toHaveLength(3);
  });
});

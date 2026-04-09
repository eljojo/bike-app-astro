import { describe, it, expect } from 'vitest';
import { groupPathsByNetwork, type NetworkMeta } from '../src/lib/bike-paths/infrastructure-grouping';

const networkMeta: Record<string, NetworkMeta> = {
  'ncc-greenbelt': { name: 'NCC Greenbelt', length_km: 132, operator: 'NCC' },
  'capital-pathway': { name: 'Capital Pathway', length_km: 220, operator: 'NCC' },
};

describe('groupPathsByNetwork', () => {
  it('groups connected and nearby paths by memberOf', () => {
    const result = groupPathsByNetwork({
      connectedPaths: [
        { slug: 'greenbelt-west', name: 'Greenbelt Pathway West', surface: 'gravel', memberOf: 'ncc-greenbelt' },
        { slug: 'pinecrest', name: 'Pinecrest Creek', surface: 'asphalt', memberOf: 'capital-pathway' },
      ],
      nearbyPaths: [
        { slug: 'greenbelt-east', name: 'Greenbelt Pathway East', surface: 'gravel', memberOf: 'ncc-greenbelt' },
      ],
      ownNetwork: 'ncc-greenbelt',
      networkMeta,
    });

    expect(result.networkGroups).toHaveLength(2);
    expect(result.networkGroups[0].slug).toBe('ncc-greenbelt');
    expect(result.networkGroups[0].isOwn).toBe(true);
    expect(result.networkGroups[0].paths).toHaveLength(2);
    expect(result.networkGroups[0].paths.find(p => p.slug === 'greenbelt-west')?.relation).toBe('connects');
    expect(result.networkGroups[0].paths.find(p => p.slug === 'greenbelt-east')?.relation).toBe('nearby');
    expect(result.networkGroups[1].slug).toBe('capital-pathway');
    expect(result.networkGroups[1].isOwn).toBe(false);
  });

  it('puts ungrouped paths in otherPaths', () => {
    const result = groupPathsByNetwork({
      connectedPaths: [
        { slug: 'kent-st', name: 'Kent Street', surface: 'asphalt' },
      ],
      nearbyPaths: [],
      ownNetwork: undefined,
      networkMeta: {},
    });

    expect(result.networkGroups).toHaveLength(0);
    expect(result.otherPaths).toHaveLength(1);
    expect(result.otherPaths[0].slug).toBe('kent-st');
  });

  it('deduplicates paths that appear in both connected and nearby', () => {
    const result = groupPathsByNetwork({
      connectedPaths: [
        { slug: 'greenbelt-west', name: 'Greenbelt West', memberOf: 'ncc-greenbelt' },
      ],
      nearbyPaths: [
        { slug: 'greenbelt-west', name: 'Greenbelt West', memberOf: 'ncc-greenbelt' },
      ],
      ownNetwork: 'ncc-greenbelt',
      networkMeta,
    });

    const grp = result.networkGroups[0];
    expect(grp.paths).toHaveLength(1);
    expect(grp.paths[0].relation).toBe('connects');
  });

  it('own network comes first even if added second', () => {
    const result = groupPathsByNetwork({
      connectedPaths: [
        { slug: 'pinecrest', name: 'Pinecrest', memberOf: 'capital-pathway' },
        { slug: 'greenbelt-west', name: 'Greenbelt West', memberOf: 'ncc-greenbelt' },
      ],
      nearbyPaths: [],
      ownNetwork: 'ncc-greenbelt',
      networkMeta,
    });

    expect(result.networkGroups[0].slug).toBe('ncc-greenbelt');
  });

  it('returns empty when no paths provided', () => {
    const result = groupPathsByNetwork({
      connectedPaths: [],
      nearbyPaths: [],
      ownNetwork: undefined,
      networkMeta: {},
    });
    expect(result.networkGroups).toHaveLength(0);
    expect(result.otherPaths).toHaveLength(0);
  });
});

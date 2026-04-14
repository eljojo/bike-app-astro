// auto-group.test.mjs
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { autoGroupNearbyPaths } from '../../../scripts/pipeline/lib/auto-group.ts';

// Fresh copies per test — entries are mutated during absorption
const rawSouthMarch = readFileSync(new URL('../fixtures/south-march-trails.json', import.meta.url), 'utf8');
const rawPineGrove = readFileSync(new URL('../fixtures/pine-grove-trails.json', import.meta.url), 'utf8');
const freshSouthMarch = () => JSON.parse(rawSouthMarch);
const freshPineGrove = () => JSON.parse(rawPineGrove);

// Park polygon enclosing all South March trails (~45.33-45.35, -75.96 to -75.93)
const southMarchParkPolygon = [
  { lat: 45.330, lon: -75.970 },
  { lat: 45.360, lon: -75.970 },
  { lat: 45.360, lon: -75.920 },
  { lat: 45.330, lon: -75.920 },
  { lat: 45.330, lon: -75.970 },
];

const mockQueryOverpass = async (q) => {
  // fetchParkPolygons queries for leisure=nature_reserve|park with geometry
  if (q.includes('leisure')) {
    return {
      elements: [{
        type: 'way',
        id: 548027518,
        tags: { name: 'South March Highlands Conservation Forest', leisure: 'nature_reserve' },
        geometry: southMarchParkPolygon,
      }],
    };
  }
  return { elements: [] };
};

describe('autoGroupNearbyPaths', () => {
  it('groups South March trails into one entry named after the park', async () => {
    const result = await autoGroupNearbyPaths({
      entries: freshSouthMarch().entries,
      markdownSlugs: new Set(),
      queryOverpass: mockQueryOverpass,
    });
    // South March trails are all < 1km — spur absorption produces one dominant entry
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('South March Highlands Conservation Forest');
    expect(result[0].osm_names).toContain('Coconut Tree');
    expect(result[0].osm_names).toContain('Beartree');
    expect(result[0].osm_names).toContain('Staycation');
    expect(result[0].osm_names).toHaveLength(6);
  });

  it('merged entry has unioned osm_names', async () => {
    const result = await autoGroupNearbyPaths({
      entries: freshSouthMarch().entries,
      markdownSlugs: new Set(),
      queryOverpass: mockQueryOverpass,
    });
    expect(result[0].osm_names).toContain('Coconut Tree');
    expect(result[0].osm_names).toContain('Beartree');
    expect(result[0].osm_names).toContain('Staycation');
  });

  it('keeps South March and Pine Grove as separate groups', async () => {
    const result = await autoGroupNearbyPaths({
      entries: [...freshSouthMarch().entries, ...freshPineGrove().entries],
      markdownSlugs: new Set(),
      queryOverpass: mockQueryOverpass,
    });
    expect(result).toHaveLength(2);
    const names = result.map(e => e.name).sort();
    expect(names.some(n => n.includes('South March'))).toBe(true);
  });

  it('does not group entries claimed by markdown', async () => {
    const result = await autoGroupNearbyPaths({
      entries: freshSouthMarch().entries,
      markdownSlugs: new Set(['coconut-tree', 'beartree']),
      queryOverpass: mockQueryOverpass,
    });
    // Coconut Tree and Beartree remain as individual entries
    const names = result.map(e => e.name);
    expect(names).toContain('Coconut Tree');
    expect(names).toContain('Beartree');
    // The dominant absorbed entry should not include excluded entries' osm_names
    const dominant = result.find(e => e.osm_names?.length > 1);
    expect(dominant.osm_names).not.toContain('Coconut Tree');
    expect(dominant.osm_names).not.toContain('Beartree');
  });

  it('absorbs new entry into existing network on re-run', async () => {
    const existingNetwork = {
      name: 'South March Highlands Conservation Forest',
      type: 'network',
      members: ['coconut-tree', 'beartree'],
      osm_names: ['Coconut Tree', 'Beartree'],
      anchors: [[-75.946, 45.342], [-75.943, 45.345]],
      surface: 'ground',
      _ways: [[{ lat: 45.342, lon: -75.946 }, { lat: 45.343, lon: -75.944 }]],
    };
    const coconut = {
      name: 'Coconut Tree',
      osm_names: ['Coconut Tree'],
      anchors: [[-75.946, 45.342]],
      surface: 'ground',
      _ways: [[{ lat: 45.342, lon: -75.946 }, { lat: 45.343, lon: -75.944 }]],
    };
    const beartree = {
      name: 'Beartree',
      osm_names: ['Beartree'],
      anchors: [[-75.943, 45.345]],
      surface: 'ground',
      _ways: [[{ lat: 45.343, lon: -75.944 }, { lat: 45.345, lon: -75.943 }]],
    };
    const newEntry = {
      name: 'New Trail',
      osm_names: ['New Trail'],
      anchors: [[-75.944, 45.343]],
      surface: 'ground',
      _ways: [[{ lat: 45.343, lon: -75.944 }, { lat: 45.344, lon: -75.942 }]],
    };
    const result = await autoGroupNearbyPaths({
      entries: [existingNetwork, coconut, beartree, newEntry],
      markdownSlugs: new Set(),
      queryOverpass: mockQueryOverpass,
    });
    const network = result.find(e => e.type === 'network');
    expect(network).toBeDefined();
    expect(network.name).toBe('South March Highlands Conservation Forest');
    expect(network.members).toContain('new-trail');
    expect(network.osm_names).toContain('New Trail');
  });

  it('is idempotent — running twice produces same output', async () => {
    const first = await autoGroupNearbyPaths({
      entries: freshSouthMarch().entries,
      markdownSlugs: new Set(),
      queryOverpass: mockQueryOverpass,
    });
    const second = await autoGroupNearbyPaths({
      entries: structuredClone(first),
      markdownSlugs: new Set(),
      queryOverpass: mockQueryOverpass,
    });
    expect(second).toHaveLength(1);
    expect(second[0].name).toBe(first[0].name);
    expect(second[0].osm_names.sort()).toEqual(first[0].osm_names.sort());
  });

  it('preserves compact bbox anchors in grouped entry', async () => {
    const result = await autoGroupNearbyPaths({
      entries: freshSouthMarch().entries,
      markdownSlugs: new Set(),
      queryOverpass: mockQueryOverpass,
    });
    expect(result[0].anchors).toHaveLength(2);
  });

  it('removes absorbed individual entries from output', async () => {
    const result = await autoGroupNearbyPaths({
      entries: freshSouthMarch().entries,
      markdownSlugs: new Set(),
      queryOverpass: mockQueryOverpass,
    });
    const allNames = result.map(e => e.name);
    expect(allNames).not.toContain('Coconut Tree');
    expect(allNames).not.toContain('Beartree');
  });

  it('MTB cluster with 3+ short members → network (no spur absorption)', async () => {
    // Three short MTB trails sharing endpoints — should become network, not absorb
    const entries = [
      {
        name: 'Loop A', highway: 'path', surface: 'ground', mtb: true,
        path_type: 'mtb-trail',
        anchors: [[-75.945, 45.344], [-75.943, 45.342]],
        _ways: [[
          { lat: 45.344, lon: -75.945 },
          { lat: 45.343, lon: -75.944 },
          { lat: 45.342, lon: -75.943 },
        ]],
      },
      {
        name: 'Loop B', highway: 'path', surface: 'ground', mtb: true,
        path_type: 'mtb-trail',
        anchors: [[-75.943, 45.342], [-75.941, 45.340]],
        _ways: [[
          { lat: 45.342, lon: -75.943 },
          { lat: 45.341, lon: -75.942 },
          { lat: 45.340, lon: -75.941 },
        ]],
      },
      {
        name: 'Loop C', highway: 'path', surface: 'ground', mtb: true,
        path_type: 'mtb-trail',
        anchors: [[-75.941, 45.340], [-75.939, 45.338]],
        _ways: [[
          { lat: 45.340, lon: -75.941 },
          { lat: 45.339, lon: -75.940 },
          { lat: 45.338, lon: -75.939 },
        ]],
      },
    ];

    const result = await autoGroupNearbyPaths({
      entries,
      markdownSlugs: new Set(),
      queryOverpass: async () => ({ elements: [] }),
    });

    // Should create a network, not absorb into one entry
    const networks = result.filter(e => e.type === 'network');
    expect(networks.length).toBe(1);
    expect(networks[0]._memberRefs.length).toBe(3);
  });
});

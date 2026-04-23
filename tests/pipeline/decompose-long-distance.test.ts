import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  decomposeLongDistancePhase,
  DECOMPOSE_WAYS_THRESHOLD,
  SUBPATH_MIN_WAYS,
} from '../../scripts/pipeline/phases/decompose-long-distance.ts';

let tempDir: string;
const nullCtx = { trace: () => {}, adapter: {}, queryOverpass: async () => ({ elements: [] }), bbox: '' } as any;

beforeAll(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decomp-test-'));
});
afterAll(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function writeCache(relId: number, features: Array<{ name: string; wayId: number }>): void {
  const data = {
    features: features.map((f) => ({
      type: 'Feature',
      properties: { name: f.name, wayId: f.wayId, sourceId: relId },
      geometry: { type: 'LineString', coordinates: [] },
    })),
  };
  fs.writeFileSync(path.join(tempDir, `${relId}.geojson`), JSON.stringify(data));
}

function bigMonolith(relId: number, wayCount: number, clusterSpec: Array<{ name: string; count: number }>) {
  let nextId = 1;
  const features: Array<{ name: string; wayId: number }> = [];
  for (const { name, count } of clusterSpec) {
    for (let i = 0; i < count; i++) features.push({ name, wayId: nextId++ });
  }
  while (features.length < wayCount) features.push({ name: '', wayId: nextId++ });
  writeCache(relId, features);
  return {
    name: 'Test Monolith',
    slug: 'test-monolith',
    type: 'long-distance',
    path_type: 'trail',
    osm_relations: [relId],
    osm_way_ids: features.map((f) => f.wayId),
  };
}

describe('decomposeLongDistancePhase', () => {
  it('is a no-op when cacheDir is missing', async () => {
    const entries = [{ name: 'X', type: 'long-distance', osm_way_ids: Array.from({ length: 200 }, (_, i) => i) }];
    const result = await decomposeLongDistancePhase({ entries, cacheDir: undefined, ctx: nullCtx });
    expect(result).toEqual(entries);
  });

  it('leaves short long-distance entries alone', async () => {
    const shortMonolith = bigMonolith(100, DECOMPOSE_WAYS_THRESHOLD - 10, [{ name: 'Only Name', count: 50 }]);
    const result = await decomposeLongDistancePhase({ entries: [shortMonolith], cacheDir: tempDir, ctx: nullCtx });
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('long-distance');
  });

  it('decomposes a monolith into sub-paths by OSM name', async () => {
    const monolith = bigMonolith(200, 200, [
      { name: 'Le P\'tit Train du Nord', count: 80 },
      { name: 'Chemin Saint-Charles', count: 40 },
      { name: 'Small Cluster', count: 5 }, // below SUBPATH_MIN_WAYS, should stay residual
    ]);
    const result = await decomposeLongDistancePhase({ entries: [monolith], cacheDir: tempDir, ctx: nullCtx });

    const parent = result.find((e: any) => e.slug === 'test-monolith');
    expect(parent.type).toBe('long-distance');
    expect(parent.members).toHaveLength(2);

    const ptt = result.find((e: any) => e.name === 'Le P\'tit Train du Nord');
    expect(ptt).toBeDefined();
    expect(ptt.type).toBe('destination');
    expect(ptt.osm_way_ids).toHaveLength(80);
    expect(ptt.member_of).toBe('test-monolith');

    const cs = result.find((e: any) => e.name === 'Chemin Saint-Charles');
    expect(cs).toBeDefined();
    expect(cs.osm_way_ids).toHaveLength(40);

    // Parent's remaining ways = small-cluster + unnamed residual
    // (200 - 80 - 40 = 80 residual ways).
    expect(parent.osm_way_ids.length).toBe(200 - 80 - 40);
  });

  it(`skips clusters below SUBPATH_MIN_WAYS (${SUBPATH_MIN_WAYS})`, async () => {
    const monolith = bigMonolith(201, 200, [
      { name: 'Cluster A', count: SUBPATH_MIN_WAYS - 1 },
      { name: 'Cluster B', count: SUBPATH_MIN_WAYS - 1 },
      { name: 'Cluster C', count: SUBPATH_MIN_WAYS - 1 },
    ]);
    const result = await decomposeLongDistancePhase({ entries: [monolith], cacheDir: tempDir, ctx: nullCtx });
    // No cluster reached the threshold, so no sub-paths created.
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('long-distance');
  });

  it('ignores the unnamed cluster when building sub-paths', async () => {
    const monolith = bigMonolith(202, 200, [
      { name: '', count: 100 }, // all unnamed — should NOT become a sub-path named "(empty)"
      { name: 'Real Name', count: 40 },
    ]);
    const result = await decomposeLongDistancePhase({ entries: [monolith], cacheDir: tempDir, ctx: nullCtx });
    const parent = result.find((e: any) => e.slug === 'test-monolith');
    expect(parent.members).toEqual([expect.stringContaining('real-name')]);
  });
});

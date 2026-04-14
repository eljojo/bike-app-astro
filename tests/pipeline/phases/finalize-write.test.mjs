import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { finalizeWritePhase } from '../../../scripts/pipeline/phases/finalize-write.ts';
import { Trace } from '../../../scripts/pipeline/engine/trace.ts';
import { WayRegistry } from '../../../scripts/pipeline/lib/way-registry.mjs';
import yaml from 'js-yaml';

const ADAPTER = { relationNamePattern: '', namedWayQueries: () => [] };

describe('finalize.write phase', () => {
  let tmpDataDir;

  beforeEach(() => {
    tmpDataDir = mkdtempSync(join(tmpdir(), 'finalize-write-'));
  });

  afterEach(() => {
    try { rmSync(tmpDataDir, { recursive: true }); } catch {}
  });

  it('computes slugs, writes the YAML file, and returns entries+slugMap', async () => {
    const trace = new Trace();
    const wayRegistry = new WayRegistry();
    const entries = [
      { name: 'Alpha Trail', highway: 'cycleway' },
      { name: 'Beta Trail', highway: 'path' },
    ];
    const out = await finalizeWritePhase({
      entries,
      superNetworks: [],
      wayRegistry,
      dataDir: tmpDataDir,
      relationBaseNames: new Set(),
      ctx: {
        bbox: '0,0,1,1', adapter: ADAPTER,
        queryOverpass: async () => ({ elements: [] }),
        trace: trace.bind('finalize.write'),
      },
    });
    expect(out.entries).toHaveLength(2);
    expect(out.slugMap).toBeInstanceOf(Map);
    expect(out.slugMap.get(entries[0])).toBe('alpha-trail');

    const written = readFileSync(join(tmpDataDir, 'bikepaths.yml'), 'utf8');
    const parsed = yaml.load(written);
    expect(parsed.bike_paths).toHaveLength(2);
    expect(parsed.bike_paths.map((e) => e.slug).sort()).toEqual(['alpha-trail', 'beta-trail']);
  });

  it('removes ghost entries (non-relation owned by relation entry)', async () => {
    const trace = new Trace();
    const wayRegistry = new WayRegistry();
    const relationEntry = { name: 'Real Trail', osm_relations: [100] };
    const ghost = { name: 'Real Trail Ghost' }; // Not a relation entry
    wayRegistry.claim(relationEntry, [501, 502]);
    wayRegistry.claim(ghost, [501, 502]); // ghost has same ways as relation
    const entries = [relationEntry, ghost];
    const out = await finalizeWritePhase({
      entries,
      superNetworks: [],
      wayRegistry,
      dataDir: tmpDataDir,
      relationBaseNames: new Set(),
      ctx: {
        bbox: '0,0,1,1', adapter: ADAPTER,
        queryOverpass: async () => ({ elements: [] }),
        trace: trace.bind('finalize.write'),
      },
    });
    // Ghost removed
    expect(out.entries.find((e) => e.name === 'Real Trail Ghost')).toBeUndefined();
    expect(out.entries.find((e) => e.name === 'Real Trail')).toBeDefined();
  });
});

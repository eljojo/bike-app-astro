import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { finalizeWritePhase } from '../../../scripts/pipeline/phases/finalize-write.ts';
import { Trace } from '../../../scripts/pipeline/engine/trace.ts';
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

  it('writes bikepaths.yml when dataDir is provided', async () => {
    const trace = new Trace();
    const entries = [
      { name: 'Alpha Trail', slug: 'alpha-trail', highway: 'cycleway' },
      { name: 'Beta Trail', slug: 'beta-trail', highway: 'path' },
    ];
    const slugMap = new Map();
    slugMap.set(entries[0], 'alpha-trail');
    slugMap.set(entries[1], 'beta-trail');

    const out = await finalizeWritePhase({
      entries,
      superNetworks: [],
      slugMap,
      dataDir: tmpDataDir,
      ctx: {
        bbox: '0,0,1,1', adapter: ADAPTER,
        queryOverpass: async () => ({ elements: [] }),
        trace: trace.bind('finalize.write'),
      },
    });
    expect(out.entries).toHaveLength(2);
    expect(out.slugMap).toBe(slugMap);

    const written = readFileSync(join(tmpDataDir, 'bikepaths.yml'), 'utf8');
    const parsed = yaml.load(written);
    expect(parsed.bike_paths).toHaveLength(2);
  });

  it('skips file write on dry run', async () => {
    const trace = new Trace();
    const entries = [{ name: 'Test', slug: 'test' }];
    const slugMap = new Map();
    slugMap.set(entries[0], 'test');

    await finalizeWritePhase({
      entries,
      superNetworks: [],
      slugMap,
      dataDir: tmpDataDir,
      dryRun: true,
      ctx: {
        bbox: '0,0,1,1', adapter: ADAPTER,
        queryOverpass: async () => ({ elements: [] }),
        trace: trace.bind('finalize.write'),
      },
    });

    const files = require('node:fs').readdirSync(tmpDataDir);
    expect(files).toHaveLength(0);
  });
});

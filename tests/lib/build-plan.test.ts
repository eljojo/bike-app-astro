import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('build-plan', () => {
  let origCwd: string;
  let tmpDir: string;

  beforeEach(() => {
    origCwd = process.cwd();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'build-plan-'));
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(origCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('loadBuildPlan returns null when no plan exists', async () => {
    const { loadBuildPlan } = await import('../../src/lib/content/build-plan');
    expect(loadBuildPlan()).toBeNull();
  });

  it('loadBuildPlan reads a valid plan', async () => {
    const { loadBuildPlan, writeBuildPlan } = await import('../../src/lib/content/build-plan');
    writeBuildPlan({ mode: 'incremental', changedSlugs: ['ride:morning'], deletedSlugs: [] });
    const plan = loadBuildPlan();
    expect(plan?.mode).toBe('incremental');
    expect(plan?.changedSlugs).toEqual(['ride:morning']);
  });

  it('loadBuildManifest returns null when version mismatches', async () => {
    const { loadBuildManifest } = await import('../../src/lib/content/build-plan');
    const dir = path.join(tmpDir, '.astro', 'cache');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'build-manifest.json'), JSON.stringify({ version: 999, codeHash: 'x', contentHashes: {} }));
    expect(loadBuildManifest()).toBeNull();
  });

  it('shouldRebuild returns true for full build', async () => {
    const { shouldRebuild } = await import('../../src/lib/content/build-plan');
    expect(shouldRebuild(null, 'ride', 'morning')).toBe(true);
    expect(shouldRebuild({ mode: 'full', changedSlugs: [], deletedSlugs: [] }, 'ride', 'morning')).toBe(true);
  });

  it('shouldRebuild filters by content type and slug', async () => {
    const { shouldRebuild } = await import('../../src/lib/content/build-plan');
    const plan = { mode: 'incremental' as const, changedSlugs: ['ride:morning', 'route:canal'], deletedSlugs: [] };
    expect(shouldRebuild(plan, 'ride', 'morning')).toBe(true);
    expect(shouldRebuild(plan, 'ride', 'afternoon')).toBe(false);
    expect(shouldRebuild(plan, 'route', 'canal')).toBe(true);
  });

  it('filterByBuildPlan filters entries', async () => {
    const { filterByBuildPlan } = await import('../../src/lib/content/build-plan');
    const entries = [{ id: 'morning' }, { id: 'afternoon' }, { id: 'evening' }];
    const plan = { mode: 'incremental' as const, changedSlugs: ['ride:morning', 'ride:evening'], deletedSlugs: [] };
    const filtered = filterByBuildPlan(entries, plan, 'ride');
    expect(filtered.map(e => e.id)).toEqual(['morning', 'evening']);
  });
});

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
    const { loadBuildPlan } = await import('../../src/lib/content/build-plan.server');
    expect(loadBuildPlan()).toBeNull();
  });

  it('loadBuildPlan reads a valid plan', async () => {
    const { loadBuildPlan, writeBuildPlan } = await import('../../src/lib/content/build-plan.server');
    writeBuildPlan({ mode: 'incremental', changedSlugs: ['ride:morning'], deletedSlugs: [] });
    const plan = loadBuildPlan();
    expect(plan?.mode).toBe('incremental');
    expect(plan?.changedSlugs).toEqual(['ride:morning']);
  });

  it('loadBuildManifest returns null when version mismatches', async () => {
    const { loadBuildManifest } = await import('../../src/lib/content/build-plan.server');
    const dir = path.join(tmpDir, '.astro', 'cache');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'build-manifest.json'), JSON.stringify({ version: 999, codeHash: 'x', contentHashes: {} }));
    expect(loadBuildManifest()).toBeNull();
  });

  it('shouldRebuild returns true for full build', async () => {
    const { shouldRebuild } = await import('../../src/lib/content/build-plan.server');
    expect(shouldRebuild(null, 'ride', 'morning')).toBe(true);
    expect(shouldRebuild({ mode: 'full', changedSlugs: [], deletedSlugs: [] }, 'ride', 'morning')).toBe(true);
  });

  it('shouldRebuild filters by content type and slug', async () => {
    const { shouldRebuild } = await import('../../src/lib/content/build-plan.server');
    const plan = { mode: 'incremental' as const, changedSlugs: ['ride:morning', 'route:canal'], deletedSlugs: [] };
    expect(shouldRebuild(plan, 'ride', 'morning')).toBe(true);
    expect(shouldRebuild(plan, 'ride', 'afternoon')).toBe(false);
    expect(shouldRebuild(plan, 'route', 'canal')).toBe(true);
  });

  it('filterByBuildPlan filters entries', async () => {
    const { filterByBuildPlan } = await import('../../src/lib/content/build-plan.server');
    const entries = [{ id: 'morning' }, { id: 'afternoon' }, { id: 'evening' }];
    const plan = { mode: 'incremental' as const, changedSlugs: ['ride:morning', 'ride:evening'], deletedSlugs: [] };
    const filtered = filterByBuildPlan(entries, plan, 'ride');
    expect(filtered.map(e => e.id)).toEqual(['morning', 'evening']);
  });

  it('filterByBuildPlan returns all entries for full build', async () => {
    const { filterByBuildPlan } = await import('../../src/lib/content/build-plan.server');
    const entries = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const filtered = filterByBuildPlan(entries, null, 'ride');
    expect(filtered).toHaveLength(3);
  });

  it('manifest round-trip preserves all fields', async () => {
    const { writeBuildManifest, loadBuildManifest, BUILD_MANIFEST_VERSION } = await import('../../src/lib/content/build-plan.server');
    const manifest = {
      version: BUILD_MANIFEST_VERSION,
      codeHash: 'abc123',
      contentHashes: { 'ride:morning': 'hash1', 'route:canal': 'hash2' },
      tourMembership: { 'ride:morning': 'europe-trip' },
    };
    writeBuildManifest(manifest);
    const loaded = loadBuildManifest();
    expect(loaded).toEqual(manifest);
  });

  it('loadBuildManifest accepts current version', async () => {
    const { writeBuildManifest, loadBuildManifest, BUILD_MANIFEST_VERSION } = await import('../../src/lib/content/build-plan.server');
    writeBuildManifest({ version: BUILD_MANIFEST_VERSION, codeHash: 'x', contentHashes: {} });
    expect(loadBuildManifest()).not.toBeNull();
  });

  it('shouldRebuild does not match slug substring', async () => {
    const { shouldRebuild } = await import('../../src/lib/content/build-plan.server');
    const plan = { mode: 'incremental' as const, changedSlugs: ['ride:morning-ride'], deletedSlugs: [] };
    // 'morning' is a substring of 'morning-ride' but should NOT match
    expect(shouldRebuild(plan, 'ride', 'morning')).toBe(false);
    expect(shouldRebuild(plan, 'ride', 'morning-ride')).toBe(true);
  });

  it('shouldRebuild does not match wrong content type with same slug', async () => {
    const { shouldRebuild } = await import('../../src/lib/content/build-plan.server');
    const plan = { mode: 'incremental' as const, changedSlugs: ['route:canal'], deletedSlugs: [] };
    expect(shouldRebuild(plan, 'ride', 'canal')).toBe(false);
  });
});

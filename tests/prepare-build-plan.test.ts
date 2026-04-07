import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  decideBuildPlan,
  scanGpxFiles,
  scanMarkdownFiles,
  hashDirFiles,
  type BuildDecisionInput,
} from '../scripts/prepare-build-plan';
import { BUILD_MANIFEST_VERSION, type BuildManifest } from '../src/lib/content/build-plan.server';

function makeManifest(overrides: Partial<BuildManifest> = {}): BuildManifest {
  return {
    version: BUILD_MANIFEST_VERSION,
    codeHash: 'abc123',
    contentHashes: {},
    ...overrides,
  };
}

function makeInput(overrides: Partial<BuildDecisionInput> = {}): BuildDecisionInput {
  return {
    forceFullBuild: false,
    previousManifest: makeManifest(),
    currentCodeHash: 'abc123',
    currentContentHashes: {},
    buildTrigger: '',
    ...overrides,
  };
}

// ── decideBuildPlan ─────────────────────────────────────────────────

describe('decideBuildPlan', () => {
  it('forces full build when forceFullBuild=true', () => {
    const plan = decideBuildPlan(makeInput({ forceFullBuild: true }));
    expect(plan.mode).toBe('full');
  });

  it('full build when no previous manifest', () => {
    const plan = decideBuildPlan(makeInput({ previousManifest: null }));
    expect(plan.mode).toBe('full');
  });

  it('full build when code hash changed', () => {
    const plan = decideBuildPlan(makeInput({
      previousManifest: makeManifest({ codeHash: 'old-hash' }),
      currentCodeHash: 'new-hash',
    }));
    expect(plan.mode).toBe('full');
  });

  it('incremental when one content item changed', () => {
    const plan = decideBuildPlan(makeInput({
      previousManifest: makeManifest({
        contentHashes: { 'route:canal': 'aaa', 'route:river': 'bbb' },
      }),
      currentContentHashes: { 'route:canal': 'aaa', 'route:river': 'ccc' },
    }));
    expect(plan.mode).toBe('incremental');
    expect(plan.changedSlugs).toEqual(['route:river']);
    expect(plan.deletedSlugs).toEqual([]);
  });

  it('detects deleted content', () => {
    // Need enough items that deletion ratio stays below 50%
    const plan = decideBuildPlan(makeInput({
      previousManifest: makeManifest({
        contentHashes: { 'route:canal': 'aaa', 'route:river': 'bbb', 'route:lake': 'ccc', 'route:hill': 'ddd' },
      }),
      currentContentHashes: { 'route:canal': 'aaa', 'route:lake': 'ccc', 'route:hill': 'ddd' },
    }));
    expect(plan.mode).toBe('incremental');
    expect(plan.deletedSlugs).toContain('route:river');
  });

  it('full build when >50% content changed', () => {
    // 3 out of 4 items changed = 75% > 50%
    const plan = decideBuildPlan(makeInput({
      previousManifest: makeManifest({
        contentHashes: { 'route:a': 'x', 'route:b': 'x', 'route:c': 'x', 'route:d': 'x' },
      }),
      currentContentHashes: { 'route:a': 'y', 'route:b': 'y', 'route:c': 'y', 'route:d': 'x' },
    }));
    expect(plan.mode).toBe('full');
  });

  it('scheduled rebuild with no changes produces incremental', () => {
    const hashes = { 'route:canal': 'aaa' };
    const plan = decideBuildPlan(makeInput({
      previousManifest: makeManifest({ contentHashes: hashes }),
      currentContentHashes: hashes,
      buildTrigger: 'schedule',
    }));
    expect(plan.mode).toBe('incremental');
    expect(plan.changedSlugs).toEqual([]);
    expect(plan.deletedSlugs).toEqual([]);
  });

  it('non-scheduled with no changes produces full build', () => {
    const hashes = { 'route:canal': 'aaa' };
    const plan = decideBuildPlan(makeInput({
      previousManifest: makeManifest({ contentHashes: hashes }),
      currentContentHashes: hashes,
      buildTrigger: '',
    }));
    expect(plan.mode).toBe('full');
  });

  it('deleted tour ride adds tour-ride cleanup slug', () => {
    // The tour-ride cleanup slug counts toward deletedSlugs, so we need enough
    // remaining items to keep the ratio below 50%.
    // With 1 deletion expanding to 2 slugs, we need currentContentHashes.length > 4.
    const plan = decideBuildPlan(makeInput({
      previousManifest: makeManifest({
        contentHashes: {
          'ride:2024-summer-day1': 'aaa',
          'ride:2024-summer-day2': 'bbb',
          'ride:2024-summer-day3': 'ccc',
          'ride:2024-fall-day1': 'ddd',
          'ride:2024-fall-day2': 'eee',
          'ride:2024-fall-day3': 'fff',
        },
        tourMembership: {
          'ride:2024-summer-day1': 'summer',
          'ride:2024-summer-day2': 'summer',
          'ride:2024-summer-day3': 'summer',
        },
      }),
      // day2 deleted, rest unchanged
      currentContentHashes: {
        'ride:2024-summer-day1': 'aaa',
        'ride:2024-summer-day3': 'ccc',
        'ride:2024-fall-day1': 'ddd',
        'ride:2024-fall-day2': 'eee',
        'ride:2024-fall-day3': 'fff',
      },
    }));
    expect(plan.mode).toBe('incremental');
    expect(plan.deletedSlugs).toContain('ride:2024-summer-day2');
    expect(plan.deletedSlugs).toContain('tour-ride:summer/2024-summer-day2');
  });
});

// ── scanGpxFiles ────────────────────────────────────────────────────

describe('scanGpxFiles', () => {
  it('finds .gpx files recursively including uppercase .GPX', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gpx-'));
    fs.writeFileSync(path.join(tmpDir, 'ride.gpx'), '<gpx/>');
    fs.mkdirSync(path.join(tmpDir, 'sub'));
    fs.writeFileSync(path.join(tmpDir, 'sub', 'RIDE.GPX'), '<gpx/>');
    fs.writeFileSync(path.join(tmpDir, 'notes.txt'), 'not a gpx');

    const results = scanGpxFiles(tmpDir, '');
    expect(results).toHaveLength(2);
    expect(results).toContain('ride.gpx');
    expect(results).toContain('sub/RIDE.GPX');

    fs.rmSync(tmpDir, { recursive: true });
  });

  it('returns empty for nonexistent directory', () => {
    const results = scanGpxFiles('/tmp/does-not-exist-xyz', '');
    expect(results).toEqual([]);
  });
});

// ── scanMarkdownFiles ───────────────────────────────────────────────

describe('scanMarkdownFiles', () => {
  it('finds .md files but skips locale variants', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-'));
    fs.writeFileSync(path.join(tmpDir, 'canal.md'), '# Canal');
    fs.writeFileSync(path.join(tmpDir, 'canal.fr.md'), '# Canal FR');
    fs.writeFileSync(path.join(tmpDir, 'canal.es.md'), '# Canal ES');
    fs.writeFileSync(path.join(tmpDir, 'river.md'), '# River');

    const results = scanMarkdownFiles(tmpDir, '');
    expect(results).toHaveLength(2);
    expect(results).toContain('canal.md');
    expect(results).toContain('river.md');
    // locale variants excluded
    expect(results).not.toContain('canal.fr.md');
    expect(results).not.toContain('canal.es.md');

    fs.rmSync(tmpDir, { recursive: true });
  });
});

// ── hashDirFiles ────────────────────────────────────────────────────

describe('hashDirFiles', () => {
  it('same files produce same hash (deterministic)', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hash-'));
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'hello');
    fs.writeFileSync(path.join(tmpDir, 'b.txt'), 'world');

    const h1 = createHash('md5');
    hashDirFiles(tmpDir, h1);
    const d1 = h1.digest('hex');

    const h2 = createHash('md5');
    hashDirFiles(tmpDir, h2);
    const d2 = h2.digest('hex');

    expect(d1).toBe(d2);

    fs.rmSync(tmpDir, { recursive: true });
  });

  it('changed content produces different hash', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hash-'));
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'hello');

    const h1 = createHash('md5');
    hashDirFiles(tmpDir, h1);
    const d1 = h1.digest('hex');

    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'changed');

    const h2 = createHash('md5');
    hashDirFiles(tmpDir, h2);
    const d2 = h2.digest('hex');

    expect(d1).not.toBe(d2);

    fs.rmSync(tmpDir, { recursive: true });
  });
});

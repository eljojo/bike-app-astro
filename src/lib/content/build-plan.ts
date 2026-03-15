// Build plan for incremental static generation.
//
// The pre-build script (scripts/prepare-build-plan.ts) writes a build plan
// to .astro/cache/build-plan.json. Pages that opt in to incremental filtering
// read this plan in getStaticPaths() to skip unchanged content.
//
// Safe by default: pages that don't read the build plan always rebuild.
// Only high-count parameterized pages (rides/detail, routes/detail, etc.)
// opt in to filtering.

import fs from 'node:fs';
import path from 'node:path';

export interface BuildManifest {
  version: number;
  /** Identifies the code state — if this changes, full rebuild required */
  codeHash: string;
  /** Per-content-item content hashes for change detection */
  contentHashes: Record<string, string>;
  /** Maps ride content key (ride:{slug}) → tourSlug for tour cleanup on deletion */
  tourMembership?: Record<string, string>;
}

export interface BuildPlan {
  mode: 'full' | 'incremental';
  /** Content slugs that were added or changed (incremental mode only) */
  changedSlugs: string[];
  /** Content slugs that were deleted (incremental mode only) */
  deletedSlugs: string[];
}

const PLAN_PATH = path.join(process.cwd(), '.astro', 'cache', 'build-plan.json');
const MANIFEST_PATH = path.join(process.cwd(), '.astro', 'cache', 'build-manifest.json');

export const BUILD_PLAN_VERSION = 1;
export const BUILD_MANIFEST_VERSION = 2;

/**
 * Load the build plan written by scripts/prepare-build-plan.ts.
 * Returns null if no plan exists (treat as full build).
 */
export function loadBuildPlan(): BuildPlan | null {
  try {
    if (!fs.existsSync(PLAN_PATH)) return null;
    return JSON.parse(fs.readFileSync(PLAN_PATH, 'utf-8')) as BuildPlan;
  } catch {
    return null;
  }
}

/** Write a build plan to disk. */
export function writeBuildPlan(plan: BuildPlan): void {
  const dir = path.dirname(PLAN_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(PLAN_PATH, JSON.stringify(plan));
}

/** Load the build manifest from the previous build. */
export function loadBuildManifest(): BuildManifest | null {
  try {
    if (!fs.existsSync(MANIFEST_PATH)) return null;
    const parsed = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8')) as BuildManifest;
    if (parsed.version !== BUILD_MANIFEST_VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Write the build manifest after a successful build. */
export function writeBuildManifest(manifest: BuildManifest): void {
  const dir = path.dirname(MANIFEST_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest));
}

/**
 * Check if a content item should be rebuilt in incremental mode.
 * Returns true if the build plan is null (full build), mode is 'full',
 * or the slug matches a changed item.
 */
export function shouldRebuild(plan: BuildPlan | null, contentType: string, slug: string): boolean {
  if (!plan || plan.mode === 'full') return true;
  const prefix = `${contentType}:`;
  return plan.changedSlugs.some(key => {
    if (key.startsWith(prefix)) {
      return key.slice(prefix.length) === slug;
    }
    return false;
  });
}

/**
 * Filter a list of content collection entries by build plan.
 * Returns all entries in full mode, only changed entries in incremental mode.
 */
export function filterByBuildPlan<T extends { id: string }>(
  entries: T[],
  plan: BuildPlan | null,
  contentType: string,
): T[] {
  if (!plan || plan.mode === 'full') return entries;
  return entries.filter(entry => shouldRebuild(plan, contentType, entry.id));
}

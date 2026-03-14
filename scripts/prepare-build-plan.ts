// Pre-build change detection. Run before `astro build` to determine
// whether a full or incremental build is needed.
//
// Reads the build manifest from the previous build, compares content
// hashes, and writes a build plan to .astro/cache/build-plan.json.
//
// Usage: npx tsx scripts/prepare-build-plan.ts
// Env: CONTENT_DIR, CITY, FORCE_FULL_BUILD

import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  loadBuildManifest,
  writeBuildPlan,
  writeBuildManifest,
  BUILD_MANIFEST_VERSION,
  type BuildPlan,
  type BuildManifest,
} from '../src/lib/content/build-plan';
import { extractDateFromPath, buildSlug, detectTours } from '../src/loaders/rides';

const CONTENT_DIR = process.env.CONTENT_DIR || path.resolve(process.cwd(), '..', 'bike-routes');
const CITY = process.env.CITY || 'ottawa';
const cityDir = path.join(CONTENT_DIR, CITY);

function computeCodeHash(): string {
  const hash = createHash('md5');

  // Try git tree hash of src/ (covers all source files in app repo)
  try {
    const treeHash = execSync('git rev-parse HEAD:src', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    hash.update(`src:${treeHash}`);
  } catch {
    // Consumer repo (blog) — source is in node_modules
    // Fall back to package-lock.json hash
    const lockPath = path.join(process.cwd(), 'package-lock.json');
    if (fs.existsSync(lockPath)) {
      hash.update(`lock:${fs.readFileSync(lockPath, 'utf-8')}`);
    }
  }

  // Include astro config (changes here affect all pages)
  for (const configFile of ['astro.config.mjs', 'astro.config.ts']) {
    const configPath = path.join(process.cwd(), configFile);
    if (fs.existsSync(configPath)) {
      hash.update(`config:${fs.readFileSync(configPath, 'utf-8')}`);
    }
  }

  return hash.digest('hex');
}

/**
 * Compute content hashes for all content items in the city directory.
 * Returns a map of content ID → content hash.
 */
function computeContentHashes(): Record<string, string> {
  const hashes: Record<string, string> = {};

  // Rides (blog instances) — use slug-based keys to match content collection IDs
  const ridesDir = path.join(cityDir, 'rides');
  if (fs.existsSync(ridesDir)) {
    const gpxFiles = scanGpxFiles(ridesDir, '');
    const tours = detectTours(gpxFiles);
    const tourByGpxPath = new Map<string, string>();
    for (const tour of tours) {
      for (const ridePath of tour.ridePaths) {
        tourByGpxPath.set(ridePath, tour.slug);
      }
    }

    for (const gpxRel of gpxFiles) {
      const date = extractDateFromPath(gpxRel);
      if (!date) continue;
      const gpxFilename = path.basename(gpxRel);
      const isTour = tourByGpxPath.has(gpxRel);
      const slug = buildSlug(date, gpxFilename, isTour);

      const gpxAbs = path.join(ridesDir, gpxRel);
      const hash = createHash('md5');
      if (fs.existsSync(gpxAbs)) hash.update(`gpx:${fs.statSync(gpxAbs).mtimeMs}`);
      const sidecar = gpxAbs.replace(/\.gpx$/i, '.md');
      if (fs.existsSync(sidecar)) hash.update(`md:${fs.statSync(sidecar).mtimeMs}`);
      const media = gpxAbs.replace(/\.gpx$/i, '-media.yml');
      if (fs.existsSync(media)) hash.update(`media:${fs.statSync(media).mtimeMs}`);
      hashes[`ride:${slug}`] = hash.digest('hex');
    }
  }

  // Routes (wiki instances)
  const routesDir = path.join(cityDir, 'routes');
  if (fs.existsSync(routesDir)) {
    for (const slug of fs.readdirSync(routesDir)) {
      const routeDir = path.join(routesDir, slug);
      if (!fs.statSync(routeDir).isDirectory()) continue;
      const hash = createHash('md5');
      hashDirFiles(routeDir, hash);
      const variantsDir = path.join(routeDir, 'variants');
      if (fs.existsSync(variantsDir)) hashDirFiles(variantsDir, hash, 'variants/');
      hashes[`route:${slug}`] = hash.digest('hex');
    }
  }

  // Events, places, pages, guides — simpler, one file each
  for (const [type, subdir] of [['event', 'events'], ['place', 'places'], ['page', 'pages'], ['guide', 'guides']] as const) {
    const dir = path.join(cityDir, subdir);
    if (!fs.existsSync(dir)) continue;
    scanMarkdownFiles(dir, '').forEach(mdRel => {
      const mdAbs = path.join(dir, mdRel);
      hashes[`${type}:${mdRel}`] = createHash('md5').update(`${fs.statSync(mdAbs).mtimeMs}`).digest('hex');
    });
  }

  return hashes;
}

function scanGpxFiles(baseDir: string, rel: string): string[] {
  const results: string[] = [];
  const absDir = rel ? path.join(baseDir, rel) : baseDir;
  if (!fs.existsSync(absDir)) return results;
  for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
    const entryRel = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) results.push(...scanGpxFiles(baseDir, entryRel));
    else if (entry.name.toLowerCase().endsWith('.gpx')) results.push(entryRel);
  }
  return results;
}

function scanMarkdownFiles(baseDir: string, rel: string): string[] {
  const results: string[] = [];
  const absDir = rel ? path.join(baseDir, rel) : baseDir;
  if (!fs.existsSync(absDir)) return results;
  for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
    const entryRel = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) results.push(...scanMarkdownFiles(baseDir, entryRel));
    else if (entry.name.endsWith('.md') && !entry.name.match(/\.\w{2}\.md$/)) results.push(entryRel);
  }
  return results;
}

function hashDirFiles(dir: string, hash: ReturnType<typeof createHash>, prefix = ''): void {
  if (!fs.existsSync(dir)) return;
  for (const file of fs.readdirSync(dir)) {
    const filePath = path.join(dir, file);
    if (fs.statSync(filePath).isFile()) {
      hash.update(`${prefix}${file}:${fs.statSync(filePath).mtimeMs}`);
    }
  }
}

// --- Main ---

const previousManifest = loadBuildManifest();
const currentCodeHash = computeCodeHash();
const currentContentHashes = computeContentHashes();
const forceFullBuild = process.env.FORCE_FULL_BUILD === '1';

let plan: BuildPlan;

if (forceFullBuild) {
  console.log('Build plan: FULL (forced via FORCE_FULL_BUILD)');
  plan = { mode: 'full', changedSlugs: [], deletedSlugs: [] };
} else if (!previousManifest) {
  console.log('Build plan: FULL (no previous manifest)');
  plan = { mode: 'full', changedSlugs: [], deletedSlugs: [] };
} else if (previousManifest.codeHash !== currentCodeHash) {
  console.log('Build plan: FULL (code changed)');
  plan = { mode: 'full', changedSlugs: [], deletedSlugs: [] };
} else {
  // Compare content hashes
  const prevHashes = previousManifest.contentHashes;
  const changedSlugs: string[] = [];
  const deletedSlugs: string[] = [];

  for (const [key, hash] of Object.entries(currentContentHashes)) {
    if (prevHashes[key] !== hash) changedSlugs.push(key);
  }
  for (const key of Object.keys(prevHashes)) {
    if (!(key in currentContentHashes)) deletedSlugs.push(key);
  }

  const totalItems = Object.keys(currentContentHashes).length;
  const changeRatio = (changedSlugs.length + deletedSlugs.length) / Math.max(totalItems, 1);

  if (changeRatio > 0.5) {
    console.log(`Build plan: FULL (${Math.round(changeRatio * 100)}% of content changed)`);
    plan = { mode: 'full', changedSlugs: [], deletedSlugs: [] };
  } else if (changedSlugs.length === 0 && deletedSlugs.length === 0) {
    console.log('Build plan: FULL (no content changes detected — rebuild anyway)');
    plan = { mode: 'full', changedSlugs: [], deletedSlugs: [] };
  } else {
    console.log(`Build plan: INCREMENTAL (${changedSlugs.length} changed, ${deletedSlugs.length} deleted)`);
    for (const slug of changedSlugs) console.log(`  + ${slug}`);
    for (const slug of deletedSlugs) console.log(`  - ${slug}`);
    plan = { mode: 'incremental', changedSlugs, deletedSlugs };
  }
}

writeBuildPlan(plan);

const manifest: BuildManifest = {
  version: BUILD_MANIFEST_VERSION,
  codeHash: currentCodeHash,
  contentHashes: currentContentHashes,
};
writeBuildManifest(manifest);

console.log(`Content items: ${Object.keys(currentContentHashes).length}`);

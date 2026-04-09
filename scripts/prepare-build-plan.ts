// Pre-build change detection. Run before `astro build` to determine
// whether a full or incremental build is needed.
//
// Reads the build manifest from the previous build, compares content
// hashes, and writes a build plan to .astro/cache/build-plan.json.
//
// Usage: npx tsx scripts/prepare-build-plan.ts
// Env: CONTENT_DIR, CITY, FORCE_FULL_BUILD, BUILD_TRIGGER

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
} from '../src/lib/content/build-plan.server';
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
 * Returns content hashes and tour membership (ride key → tour slug).
 */
function computeContentHashes(): { hashes: Record<string, string>; tourMembership: Record<string, string> } {
  const hashes: Record<string, string> = {};
  const tourMembership: Record<string, string> = {};

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
      if (fs.existsSync(gpxAbs)) hash.update(fs.readFileSync(gpxAbs));
      const sidecar = gpxAbs.replace(/\.gpx$/i, '.md');
      if (fs.existsSync(sidecar)) hash.update(fs.readFileSync(sidecar));
      const media = gpxAbs.replace(/\.gpx$/i, '-media.yml');
      if (fs.existsSync(media)) hash.update(fs.readFileSync(media));
      hashes[`ride:${slug}`] = hash.digest('hex');

      // Track tour membership for deletion cleanup
      const tourSlug = tourByGpxPath.get(gpxRel);
      if (tourSlug) tourMembership[`ride:${slug}`] = tourSlug;
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
      hashes[`${type}:${mdRel}`] = createHash('md5').update(fs.readFileSync(mdAbs)).digest('hex');
    });
  }

  // Bike paths — hash bikepaths.yml + individual markdown files
  const bikePathsYml = path.join(cityDir, 'bikepaths.yml');
  if (fs.existsSync(bikePathsYml)) {
    const ymlHash = createHash('md5').update(fs.readFileSync(bikePathsYml)).digest('hex');
    const bikePathsMdDir = path.join(cityDir, 'bike-paths');
    if (fs.existsSync(bikePathsMdDir)) {
      // Track which base slugs we've already hashed (avoid duplicates from locale variants)
      const hashedSlugs = new Set<string>();
      for (const file of fs.readdirSync(bikePathsMdDir)) {
        if (!file.endsWith('.md')) continue;
        // Extract base slug: "canal-pathway.fr.md" → "canal-pathway", "canal-pathway.md" → "canal-pathway"
        const slug = file.replace(/\.\w{2}\.md$/, '').replace(/\.md$/, '');
        if (hashedSlugs.has(slug)) continue;
        hashedSlugs.add(slug);

        const hash = createHash('md5');
        hash.update(ymlHash); // YML changes invalidate all bike paths
        // Hash all locale variants for this slug
        for (const mdFile of fs.readdirSync(bikePathsMdDir)) {
          if (mdFile === `${slug}.md` || mdFile.match(new RegExp(`^${slug}\\.\\w{2}\\.md$`))) {
            hash.update(fs.readFileSync(path.join(bikePathsMdDir, mdFile)));
          }
        }
        hashes[`bike-path:${slug}`] = hash.digest('hex');
      }
    }
  }

  return { hashes, tourMembership };
}

export function scanGpxFiles(baseDir: string, rel: string): string[] {
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

export function scanMarkdownFiles(baseDir: string, rel: string): string[] {
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

export function hashDirFiles(dir: string, hash: ReturnType<typeof createHash>, prefix = ''): void {
  if (!fs.existsSync(dir)) return;
  for (const file of fs.readdirSync(dir)) {
    const filePath = path.join(dir, file);
    if (fs.statSync(filePath).isFile()) {
      hash.update(`${prefix}${file}:`);
      hash.update(fs.readFileSync(filePath));
    }
  }
}

// --- Exported pure decision logic ---

export interface BuildDecisionInput {
  forceFullBuild: boolean;
  previousManifest: BuildManifest | null;
  currentCodeHash: string;
  currentContentHashes: Record<string, string>;
  buildTrigger: string;
  previousTourMembership?: Record<string, string>;
}

export function decideBuildPlan(input: BuildDecisionInput): BuildPlan {
  const { forceFullBuild, previousManifest, currentCodeHash, currentContentHashes, buildTrigger, previousTourMembership } = input;

  if (forceFullBuild) {
    return { mode: 'full', changedSlugs: [], deletedSlugs: [] };
  }
  if (!previousManifest) {
    return { mode: 'full', changedSlugs: [], deletedSlugs: [] };
  }
  if (previousManifest.codeHash !== currentCodeHash) {
    return { mode: 'full', changedSlugs: [], deletedSlugs: [] };
  }

  // Compare content hashes
  const prevHashes = previousManifest.contentHashes;
  const changedSlugs: string[] = [];
  const deletedSlugs: string[] = [];

  for (const [key, hash] of Object.entries(currentContentHashes)) {
    if (prevHashes[key] !== hash) changedSlugs.push(key);
  }
  const prevTourMembership_ = previousTourMembership ?? previousManifest.tourMembership ?? {};
  for (const key of Object.keys(prevHashes)) {
    if (!(key in currentContentHashes)) {
      deletedSlugs.push(key);
      // If the deleted ride was in a tour, also mark the tour-ride path for cleanup
      const tourSlug = prevTourMembership_[key];
      if (tourSlug) {
        const rideSlug = key.slice('ride:'.length);
        deletedSlugs.push(`tour-ride:${tourSlug}/${rideSlug}`);
      }
    }
  }

  const totalItems = Object.keys(currentContentHashes).length;
  const changeRatio = (changedSlugs.length + deletedSlugs.length) / Math.max(totalItems, 1);

  if (changeRatio > 0.5) {
    return { mode: 'full', changedSlugs: [], deletedSlugs: [] };
  }
  if (changedSlugs.length === 0 && deletedSlugs.length === 0) {
    if (buildTrigger === 'schedule') {
      return { mode: 'incremental', changedSlugs: [], deletedSlugs: [] };
    }
    return { mode: 'full', changedSlugs: [], deletedSlugs: [] };
  }

  return { mode: 'incremental', changedSlugs, deletedSlugs };
}

// --- Main ---

const _isDirectRun = process.argv[1]?.endsWith('prepare-build-plan.ts');
if (_isDirectRun) {
  const previousManifest = loadBuildManifest();
  const currentCodeHash = computeCodeHash();
  const { hashes: currentContentHashes, tourMembership: currentTourMembership } = computeContentHashes();
  const forceFullBuild = process.env.FORCE_FULL_BUILD === '1';
  const buildTrigger = process.env.BUILD_TRIGGER || '';

  const plan = decideBuildPlan({
    forceFullBuild,
    previousManifest,
    currentCodeHash,
    currentContentHashes,
    buildTrigger,
  });

  if (plan.mode === 'full') {
    if (forceFullBuild) console.log('Build plan: FULL (forced via FORCE_FULL_BUILD)');
    else if (!previousManifest) console.log('Build plan: FULL (no previous manifest)');
    else if (previousManifest.codeHash !== currentCodeHash) console.log('Build plan: FULL (code changed)');
    else if (plan.changedSlugs.length === 0 && plan.deletedSlugs.length === 0) console.log('Build plan: FULL (no content changes detected — rebuild anyway)');
    else console.log('Build plan: FULL (>50% content changed)');
  } else {
    if (plan.changedSlugs.length === 0 && plan.deletedSlugs.length === 0) {
      console.log('Build plan: INCREMENTAL (scheduled rebuild — date-sensitive pages only)');
    } else {
      console.log(`Build plan: INCREMENTAL (${plan.changedSlugs.length} changed, ${plan.deletedSlugs.length} deleted)`);
      for (const slug of plan.changedSlugs) console.log(`  + ${slug}`);
      for (const slug of plan.deletedSlugs) console.log(`  - ${slug}`);
    }
  }

  writeBuildPlan(plan);

  const manifest: BuildManifest = {
    version: BUILD_MANIFEST_VERSION,
    codeHash: currentCodeHash,
    contentHashes: currentContentHashes,
    tourMembership: Object.keys(currentTourMembership).length > 0 ? currentTourMembership : undefined,
  };
  writeBuildManifest(manifest);

  console.log(`Content items: ${Object.keys(currentContentHashes).length}`);
}

#!/usr/bin/env node

/**
 * Build bikepaths.yml — the city's cycling infrastructure registry.
 *
 * Discovers cycling infrastructure from OSM, builds entries from scratch
 * on every run (no incremental merge with existing file), and optionally
 * enriches with network discovery and Wikidata metadata.
 *
 * Region-specific behavior (OSM query patterns, external data sources) is
 * defined in lib/city-adapter.mjs.
 *
 * Usage:
 *   node scripts/build-bikepaths.ts --city santiago
 *   node scripts/build-bikepaths.ts --city ottawa --dry-run
 *
 * ## Pipeline
 *
 * 1. loadManualEntries() — read manual-entries.yml sidecar
 * 2. buildBikepathsPipeline() — discover relations, named ways, parallel lanes,
 *    build entries, enrich, network/cluster, slug, resolve members, wikidata
 * 3. Write YAML (strip transient fields)
 */

import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { queryOverpass as _queryOverpass, createRecorder } from './lib/overpass.mjs';

// Record all Overpass calls to a cassette in .cache/ (gitignored) for test replay.
// Usage: RECORD_OVERPASS=ottawa node scripts/build-bikepaths.ts --city ottawa
// Replay: createPlayer('ottawa') in tests
const queryOverpass = process.env.RECORD_OVERPASS
  ? createRecorder(process.env.RECORD_OVERPASS)
  : _queryOverpass;
import { slugifyBikePathName as slugify } from '../../src/lib/bike-paths/bikepaths-yml.server.ts';
import { loadCityAdapter } from './lib/city-adapter.mjs';
import { autoGroupNearbyPaths } from './lib/auto-group.mjs';
import { WayRegistry } from './lib/way-registry.mjs';
import { mergeWayTags } from './lib/osm-tags.ts';
// Re-export for test compatibility (tests import mergeWayTags from this file)
export { mergeWayTags };
import { loadManualEntries, loadMarkdownSlugs, parseMarkdownOverrides, writeYaml } from './lib/pipeline-io.ts';
// Re-export for test compatibility (tests import parseMarkdownOverrides from this file)
export { parseMarkdownOverrides };
import { discover } from './lib/discover.ts';
import { assemble } from './lib/assemble.ts';
import { resolve } from './lib/resolve.ts';

// ---------------------------------------------------------------------------
// CLI (only when run directly, not when imported)
// ---------------------------------------------------------------------------

let args: Record<string, any> = {};
let dataDir: string;
let bikepathsPath: string;
let bbox: string;
let adapter: any;

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/.*\//, ''));
if (isMain) {
  args = {};
  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === '--city') args.city = process.argv[++i];
    if (process.argv[i] === '--dry-run') args.dryRun = true;
  }
  if (!args.city) {
    console.error('Usage: node scripts/build-bikepaths.ts --city <city>');
    process.exit(1);
  }

  const contentDir = process.env.CONTENT_DIR || path.resolve('..', 'bike-routes');
  dataDir = path.join(contentDir, args.city);
  bikepathsPath = path.join(dataDir, 'bikepaths.yml');

  // Read city bounds from config.yml
  const configPath = path.join(dataDir, 'config.yml');
  if (!fs.existsSync(configPath)) {
    console.error(`No config.yml found for city: ${args.city} (looked at ${configPath})`);
    process.exit(1);
  }
  const cityConfig = yaml.load(fs.readFileSync(configPath, 'utf8')) as Record<string, any>;
  if (!cityConfig.bounds) {
    console.error(`No bounds defined in ${configPath}`);
    process.exit(1);
  }
  // Use overpass_bounds if defined (tighter area for querying), otherwise bounds
  const bounds = cityConfig.overpass_bounds || cityConfig.bounds;
  bbox = `${bounds.south},${bounds.west},${bounds.north},${bounds.east}`;

  // Load city adapter for region-specific queries
  adapter = loadCityAdapter(args.city);
}

// ---------------------------------------------------------------------------
// Step 1: Load manual entries from sidecar file — see lib/pipeline-io.ts
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Helper functions: loadMarkdownSlugs, parseMarkdownOverrides — see lib/pipeline-io.ts
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// The pipeline. One function, one code path. main() calls it with the real
// Overpass client. Tests call it with a cassette player.
// ---------------------------------------------------------------------------

/**
 * Run the full bikepaths pipeline. No file I/O — returns entries + metadata.
 */
export async function buildBikepathsPipeline({ queryOverpass: qo, bbox: b, adapter: a, manualEntries = [], markdownSlugs = new Set<string>(), markdownOverrides = new Map<string, { member_of?: string }>() }: {
  queryOverpass: (q: string) => Promise<{ elements: any[] }>;
  bbox: string;
  adapter: any;
  manualEntries?: any[];
  markdownSlugs?: Set<string>;
  markdownOverrides?: Map<string, { member_of?: string }>;
}): Promise<{ entries: any[]; superNetworks: any[]; slugMap: Map<any, string>; wayRegistry: WayRegistry }> {
  // Steps 1-2d: Discover all OSM cycling infrastructure
  const wayRegistry = new WayRegistry();
  const { osmRelations, osmNamedWays, parallelLanes, nonCyclingCandidates, relationBaseNames } =
    await discover({ queryOverpass: qo, bbox: b, adapter: a }, wayRegistry);

  // Step 3: Build entries, enrich, classify
  const entries = await assemble({
    osmRelations, osmNamedWays, parallelLanes,
    manualEntries,
    wayRegistry,
    queryOverpass: qo,
  });

  // Step 4: Auto-group nearby trail segments (with park containment)
  // @ts-expect-error — auto-group.mjs JSDoc omits bbox/wayRegistry but the function uses them
  const grouped: any[] = await autoGroupNearbyPaths({ entries, markdownSlugs, queryOverpass: qo, bbox: b, wayRegistry });

  // Steps 5-9: Resolve networks, apply overrides, validate
  const { superNetworks, slugMap } = await resolve({
    entries: grouped,
    discovered: { osmRelations, osmNamedWays, parallelLanes, nonCyclingCandidates, relationBaseNames },
    wayRegistry,
    ctx: { queryOverpass: qo, bbox: b, adapter: a },
    markdownSlugs,
    markdownOverrides,
  });

  return { entries: grouped, superNetworks, slugMap, wayRegistry };
}

// ---------------------------------------------------------------------------
// main() — thin wrapper: load config, run pipeline, write YAML
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(`Building bikepaths.yml for ${args.city} (bbox: ${bbox})`);

  const manualEntries = loadManualEntries(dataDir);
  const markdownSlugs = loadMarkdownSlugs(dataDir);
  const bikePathsDir = path.join(dataDir, 'bike-paths');
  const markdownOverrides = parseMarkdownOverrides(bikePathsDir);

  const { entries, superNetworks, slugMap } = await buildBikepathsPipeline({
    queryOverpass,
    bbox,
    adapter,
    manualEntries,
    markdownSlugs,
    markdownOverrides,
  });

  // Write output
  const networkEntries = entries.filter((e: any) => e.type === 'network');
  const memberEntries = entries.filter((e: any) => e.member_of);
  if (args.dryRun) {
    console.log('\n--- DRY RUN — would write: ---');
    for (const entry of entries) {
      const slug = slugMap.get(entry) || slugify(entry.name);
      const source = entry.type === 'network' ? `network (${entry.members?.length || 0} members)` :
        entry.member_of ? `member of ${entry.member_of}` :
        entry.osm_relations ? `relation ${entry.osm_relations[0]}` :
        entry.parallel_to ? `parallel to "${entry.parallel_to}"` :
        `name "${entry.osm_names?.[0] || entry.name}"`;
      console.log(`  ${slug}: ${entry.name} (${source})`);
    }
    console.log(`\nTotal: ${entries.length} entries (${networkEntries.length} networks, ${memberEntries.length} members, ${superNetworks.length} super-networks)`);
  } else {
    writeYaml(entries, superNetworks, bikepathsPath, slugMap);
  }
}

if (isMain) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}

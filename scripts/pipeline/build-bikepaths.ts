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
import { queryOverpass } from './lib/overpass.ts';
import { slugifyBikePathName as slugify } from '../../src/lib/bike-paths/bikepaths-yml.server.ts';
import { loadCityAdapter } from './lib/city-adapter.mjs';
import { WayRegistry } from './lib/way-registry.mjs';
import { mergeWayTags } from './lib/osm-tags.ts';
// Re-export for test compatibility (tests import mergeWayTags from this file)
export { mergeWayTags };
import { loadManualEntries, loadMarkdownSlugs, parseMarkdownOverrides } from './lib/pipeline-io.ts';
// Re-export for test compatibility (tests import parseMarkdownOverrides from this file)
export { parseMarkdownOverrides };
import { TaskGraph } from './engine/task-graph.ts';
import { Trace } from './engine/trace.ts';
import { discoverRelationsPhase } from './phases/discover-relations.ts';
import { discoverNamedWaysPhase } from './phases/discover-named-ways.ts';
import { discoverParallelLanesPhase } from './phases/discover-parallel-lanes.ts';
import { discoverUnnamedChainsPhase } from './phases/discover-unnamed-chains.ts';
import { discoverNonCyclingPhase } from './phases/discover-non-cycling.ts';
import { assembleEntriesPhase } from './phases/assemble-entries.ts';
import { groupClusterPhase } from './phases/group-cluster.ts';
import { resolveNetworksPhase } from './phases/resolve-networks.ts';
import { resolveClassificationPhase } from './phases/resolve-classification.ts';
import { finalizeOverridesPhase } from './phases/finalize-overrides.ts';
import { finalizeResolvePhase } from './phases/finalize-resolve.ts';
import { finalizeWritePhase } from './phases/finalize-write.ts';

// ---------------------------------------------------------------------------
// CLI (only when run directly, not when imported)
// ---------------------------------------------------------------------------

let args: Record<string, any> = {};
let dataDir: string;
let bbox: string;
let adapter: any;

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/.*\//, ''));
if (isMain) {
  args = {};
  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === '--city') args.city = process.argv[++i];
    if (process.argv[i] === '--dry-run') args.dryRun = true;
    if (process.argv[i] === '--trace') args.trace = process.argv[++i];
    if (process.argv[i].startsWith('--trace=')) args.trace = process.argv[i].slice('--trace='.length);
  }
  if (!args.city) {
    console.error('Usage: node scripts/build-bikepaths.ts --city <city>');
    process.exit(1);
  }

  const contentDir = process.env.CONTENT_DIR || path.resolve('..', 'bike-routes');
  dataDir = path.join(contentDir, args.city);

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
// The pipeline. One function, one code path. main() calls it with the real
// Overpass client. Tests call it with a cassette player.
// ---------------------------------------------------------------------------

/**
 * Run the full bikepaths pipeline end-to-end through the task graph.
 *
 * When `dataDir` is provided and `dryRun` is false, the terminal
 * `finalize.write` phase writes `${dataDir}/bikepaths.yml`. Tests omit
 * `dataDir` and receive the in-memory entries without touching disk.
 */
export async function buildBikepathsPipeline({ queryOverpass: qo, bbox: b, adapter: a, manualEntries = [], markdownSlugs = new Set<string>(), markdownOverrides = new Map<string, Record<string, any>>(), dataDir, dryRun = false }: {
  queryOverpass: (q: string) => Promise<{ elements: any[] }>;
  bbox: string;
  adapter: any;
  manualEntries?: any[];
  markdownSlugs?: Set<string>;
  markdownOverrides?: Map<string, Record<string, any>>;
  dataDir?: string;
  dryRun?: boolean;
}): Promise<{ entries: any[]; superNetworks: any[]; slugMap: Map<any, string>; wayRegistry: WayRegistry; trace: Trace }> {
  // Steps 1-2d: Discover all OSM cycling infrastructure via TaskGraph
  const wayRegistry = new WayRegistry();
  const trace = new Trace({ enabled: process.env.TRACE !== 'off', city: process.env.CITY });
  const graph = new TaskGraph();

  // Helper: wraps a phase run fn with a per-phase trace binding
  function withTrace<T>(phaseName: string, fn: (args: any) => Promise<T>) {
    return async (args: any) => {
      const phaseCtx = { ...args.ctx, trace: trace.bind(phaseName) };
      return fn({ ...args, ctx: phaseCtx });
    };
  }

  graph.define({
    name: 'discover.relations',
    produces: 'OsmRelation[]',
    run: withTrace('discover.relations', ({ ctx }) => discoverRelationsPhase({ ctx })),
  });
  graph.define({
    name: 'discover.namedWays',
    produces: 'NamedWayEntry[]',
    run: withTrace('discover.namedWays', ({ ctx }) => discoverNamedWaysPhase({ ctx })),
  });
  graph.define({
    name: 'discover.parallelLanes',
    produces: 'ParallelLane[]',
    run: withTrace('discover.parallelLanes', ({ ctx }) => discoverParallelLanesPhase({ ctx })),
  });
  graph.define({
    name: 'discover.unnamedChains',
    produces: 'NamedWayEntry[]',
    run: withTrace('discover.unnamedChains', ({ ctx }) => discoverUnnamedChainsPhase({ ctx })),
  });
  graph.define({
    name: 'discover.nonCycling',
    produces: 'NonCyclingCandidate[]',
    deps: {
      relations: 'discover.relations',
      namedWays: 'discover.namedWays',
      unnamedChains: 'discover.unnamedChains',
    },
    // Pass [...namedWays, ...unnamedChains] so the spider query walks UP
    // from every cycling way ID (including chain ways).
    run: withTrace('discover.nonCycling', ({ relations, namedWays, unnamedChains, ctx }) =>
      discoverNonCyclingPhase({ relations, namedWays: [...namedWays, ...unnamedChains], ctx })),
  });

  // Structural bundling node — not a numbered phase. Packages the 5
  // discovery outputs into a single DiscoveredData object so downstream
  // phases can declare one dep instead of five.
  graph.define({
    name: 'discover.bundle',
    produces: 'DiscoveredData',
    deps: {
      relations: 'discover.relations',
      namedWays: 'discover.namedWays',
      parallelLanes: 'discover.parallelLanes',
      unnamedChains: 'discover.unnamedChains',
      nonCycling: 'discover.nonCycling',
    },
    run: async ({ relations, namedWays, parallelLanes, unnamedChains, nonCycling }: any) => ({
      osmRelations: relations,
      osmNamedWays: [...namedWays, ...unnamedChains],
      parallelLanes,
      nonCyclingCandidates: nonCycling,
      relationBaseNames: new Set<string>(
        (relations as any[]).map((r) => r.name.replace(/\s*\(.*?\)\s*$/, '').toLowerCase())
      ),
    }),
  });

  graph.define({
    name: 'assemble.entries',
    produces: 'Entry[]',
    deps: { discovered: 'discover.bundle' },
    run: withTrace('assemble.entries', ({ discovered, ctx }: any) =>
      assembleEntriesPhase({ discovered, manualEntries, wayRegistry, ctx })),
  });

  graph.define({
    name: 'group.cluster',
    produces: 'Entry[]',
    deps: { entries: 'assemble.entries' },
    run: withTrace('group.cluster', ({ entries, ctx }: any) =>
      groupClusterPhase({ entries, markdownSlugs, wayRegistry, ctx })),
  });

  graph.define({
    name: 'resolve.networks',
    produces: '{entries, superNetworks}',
    deps: { entries: 'group.cluster', discovered: 'discover.bundle' },
    run: withTrace('resolve.networks', ({ entries, discovered, ctx }: any) =>
      resolveNetworksPhase({ entries, discovered, wayRegistry, ctx })),
  });

  graph.define({
    name: 'resolve.classification',
    produces: 'Entry[]',
    deps: { netResult: 'resolve.networks', discovered: 'discover.bundle' },
    run: withTrace('resolve.classification', ({ netResult, discovered, ctx }: any) =>
      resolveClassificationPhase({ entries: netResult.entries, discovered, wayRegistry, ctx })),
  });

  graph.define({
    name: 'finalize.overrides',
    produces: 'Entry[]',
    deps: { entries: 'resolve.classification' },
    run: withTrace('finalize.overrides', ({ entries, ctx }: any) =>
      finalizeOverridesPhase({ entries, markdownOverrides, ctx })),
  });

  graph.define({
    name: 'finalize.resolve',
    produces: '{entries, slugMap}',
    deps: {
      entries: 'finalize.overrides',
      netResult: 'resolve.networks',
      discovered: 'discover.bundle',
    },
    run: withTrace('finalize.resolve', async ({ entries, netResult, discovered, ctx }: any) =>
      finalizeResolvePhase({
        entries,
        superNetworks: netResult.superNetworks,
        wayRegistry,
        relationBaseNames: discovered.relationBaseNames,
        ctx,
      })),
  });

  graph.define({
    name: 'finalize.write',
    produces: '{entries, slugMap}',
    deps: { resolved: 'finalize.resolve' },
    run: withTrace('finalize.write', async ({ resolved, ctx }: any) =>
      finalizeWritePhase({
        entries: resolved.entries,
        superNetworks: resolved.superNetworks,
        slugMap: resolved.slugMap,
        dataDir,
        dryRun,
        ctx,
      })),
  });

  const concurrency = Number(process.env.OVERPASS_CONCURRENCY) || 4;
  const finalResult = await graph.run({
    goal: 'finalize.write',
    context: { bbox: b, adapter: a, queryOverpass: qo },
    concurrency,
    onEvent: (evt: any) => {
      if (evt.type === 'done' && trace.enabled) trace.recordPhaseSummary(evt.step, evt.ms);
      const msPart = evt.ms ? ` (${evt.ms.toFixed(0)}ms)` : '';
      if (evt.type === 'fail') {
        console.error(`[graph] ${evt.type} ${evt.step}${msPart}`, evt.error);
      } else {
        console.log(`[graph] ${evt.type} ${evt.step}${msPart}`);
      }
    },
  });

  // Auto-generate _ctx/pipeline-graph.md from the live graph state.
  // This file is committed; CI compares to detect drift.
  if (process.env.CI !== 'true') {
    const ctxPath = path.resolve('_ctx/pipeline-graph.md');
    const mermaid = graph.diagram({ format: 'mermaid' });
    const tableRows = [...graph.steps.values()].map((step: any) => {
      const deps = Object.values(step.deps).join(', ') || '—';
      const produces = step.produces || '—';
      return `| ${step.name} | ${deps} | ${produces} |`;
    }).join('\n');
    const md = `---
description: "Auto-generated phase dependency graph with data-flow labels — do not edit by hand"
type: knowledge
triggers: [modifying the pipeline, adding phases, understanding phase dependencies]
related: [pipeline-overview]
---

# Pipeline graph (auto-generated)

> **Generated by \`make bikepaths\` from the live TaskGraph in \`scripts/pipeline/build-bikepaths.ts\`. Do not edit by hand.**
>
> See \`_ctx/pipeline-overview.md\` for architecture and trace workflow.

## Phases

| Phase | Depends on | Produces |
|---|---|---|
${tableRows}

## Graph

\`\`\`mermaid
${mermaid}
\`\`\`

<!-- regenerated by make bikepaths -->
`;
    fs.writeFileSync(ctxPath, md);
    console.log(`[graph] wrote ${ctxPath}`);
  }

  const { entries, superNetworks, slugMap } = finalResult as any;
  return { entries, superNetworks: superNetworks ?? [], slugMap, wayRegistry, trace };
}

// ---------------------------------------------------------------------------
// Trace CLI helper — prints a per-subject timeline from a loaded trace dump.
// Invoked by main() when --trace=<subject> is passed on the command line.
// ---------------------------------------------------------------------------

function printSubjectTimeline(trace: Trace, id: string): void {
  const subj = trace.subject(id);
  console.log(`${id}${subj.displayName ? `  "${subj.displayName}"` : ''}`);
  console.log('');
  let lastPhase: string | null = null;
  for (const event of subj.events) {
    if (event.phase !== lastPhase) {
      console.log(`[${event.t.toFixed(0)}ms] ${event.phase}`);
      lastPhase = event.phase;
    }
    const dataStr = event.data ? '  ' + JSON.stringify(event.data) : '';
    console.log(`  → ${event.kind}${dataStr}`);
  }
  if (subj.events.length === 0) {
    console.log('(no events recorded for this subject)');
  }
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

  const { entries, superNetworks, slugMap, trace } = await buildBikepathsPipeline({
    queryOverpass,
    bbox,
    adapter,
    manualEntries,
    markdownSlugs,
    markdownOverrides,
    dataDir,
    dryRun: args.dryRun,
  });

  // The finalize.write phase writes bikepaths.yml when !dryRun. In dry-run
  // mode it skips the file write but still returns fully-resolved entries
  // so we can summarise them here.
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
  } else if (trace.enabled) {
    const tracePath = path.join(dataDir, '.pipeline-debug', 'trace.json');
    trace.saveTo(tracePath);
    console.log(`[trace] wrote ${tracePath}`);
  }

  // Handle --trace queries: load the just-written trace and print a
  // human-readable timeline for the requested subject (e.g. way:278992292).
  if (args.trace) {
    const tracePath = path.join(dataDir, '.pipeline-debug', 'trace.json');
    if (!fs.existsSync(tracePath)) {
      console.error(`No trace dump at ${tracePath}. Set TRACE=on (default) and re-run make bikepaths.`);
      process.exit(1);
    }
    console.log('');
    const loaded = Trace.load(tracePath);
    printSubjectTimeline(loaded, args.trace);
  }
}

if (isMain) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}

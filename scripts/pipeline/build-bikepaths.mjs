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
 *   node scripts/build-bikepaths.mjs --city santiago
 *   node scripts/build-bikepaths.mjs --city ottawa --dry-run
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
// Usage: RECORD_OVERPASS=ottawa node scripts/build-bikepaths.mjs --city ottawa
// Replay: createPlayer('ottawa') in tests
const queryOverpass = process.env.RECORD_OVERPASS
  ? createRecorder(process.env.RECORD_OVERPASS)
  : _queryOverpass;
import { slugifyBikePathName as slugify } from '../../src/lib/bike-paths/bikepaths-yml.server.ts';
import { loadCityAdapter } from './lib/city-adapter.mjs';
import { autoGroupNearbyPaths, computeSlugs } from './lib/auto-group.mjs';
import { discoverNetworks, discoverRouteSystemNetworks } from './lib/discover-networks.mjs';
import { enrichWithWikidata } from './lib/wikidata.mjs';
import { classifyPathsLate } from '../../src/lib/bike-paths/classify-path.ts';
import { deriveEntryType, isLongDistance } from './lib/entry-type.mjs';
import { WayRegistry } from './lib/way-registry.mjs';
import { mergeWayTags } from './lib/osm-tags.ts';
// Re-export for test compatibility (tests import mergeWayTags from this file)
export { mergeWayTags };
import { loadManualEntries, loadMarkdownSlugs, parseMarkdownOverrides, writeYaml } from './lib/pipeline-io.ts';
// Re-export for test compatibility (tests import parseMarkdownOverrides from this file)
export { parseMarkdownOverrides };
import { discover } from './lib/discover.ts';
import { assemble } from './lib/assemble.ts';

// ---------------------------------------------------------------------------
// CLI (only when run directly, not when imported)
// ---------------------------------------------------------------------------

let args = {}, dataDir, bikepathsPath, bbox, adapter;

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/.*\//, ''));
if (isMain) {
  args = {};
  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === '--city') args.city = process.argv[++i];
    if (process.argv[i] === '--dry-run') args.dryRun = true;
  }
  if (!args.city) {
    console.error('Usage: node scripts/build-bikepaths.mjs --city <city>');
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
  const cityConfig = yaml.load(fs.readFileSync(configPath, 'utf8'));
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
// Resolve network members
// ---------------------------------------------------------------------------

// Apply OSM superroute data as super_network attributes on entries.
// Super-networks (Capital Pathway, TCT) are NOT pages — they're metadata
// that shows in the facts table and influences index grouping.
// The real networks come from auto-grouping (type: network).
// Turn OSM superroutes into real type: network entries.
// Members that are already in an auto-group network stay there —
// the auto-group network gets a super_network attribute for index grouping.
// Only orphaned paths (not in any network) become direct members.
function addSuperrouteNetworks(entries, networks, wayRegistry) {
  const byRelation = new Map();
  for (const entry of entries) {
    for (const relId of entry.osm_relations ?? []) {
      byRelation.set(relId, entry);
    }
  }

  // Snapshot: entries in park-based networks should not be reassigned.
  // Park containment is the strongest signal. Auto-group networks CAN be
  // flattened into superroute networks.
  const parkNetworks = new Set();
  for (const entry of entries) {
    if (entry.type === 'network' && entry._parkName) parkNetworks.add(entry);
  }
  const parkMembers = new Set();
  for (const entry of entries) {
    if (entry._networkRef && parkNetworks.has(entry._networkRef)) {
      parkMembers.add(entry);
    }
  }

  const superNetworkMeta = [];

  // Sort networks least-specific-first so the most specific (local)
  // network processes last and wins super_network assignment.
  // ncn (national) < rcn (regional) < lcn (local) < unknown.
  // Capital Pathway (rcn) should beat Trans Canada Trail (ncn).
  const NET_PRIORITY = { ncn: 0, rcn: 1, lcn: 2 };
  const sortedNetworks = [...networks]
    .filter(n => !n._promoted)
    .sort((a, b) => {
      const pa = NET_PRIORITY[a.network] ?? 3;
      const pb = NET_PRIORITY[b.network] ?? 3;
      return pa - pb;
    });

  for (const network of sortedNetworks) {
    const name = network.name;

    // Create network entry shell — _memberRefs populated below
    const networkEntry = {
      name,
      type: 'network',
      _memberRefs: [],
      osm_relations: network.osm_relations,
    };
    if (network.name_fr) networkEntry.name_fr = network.name_fr;
    if (network.name_en) networkEntry.name_en = network.name_en;
    if (network.operator) networkEntry.operator = network.operator;
    if (network.network) networkEntry.network = network.network;
    if (network.wikidata) networkEntry.wikidata = network.wikidata;
    if (network.wikipedia) networkEntry.wikipedia = network.wikipedia;
    if (network.cycle_network) networkEntry.cycle_network = network.cycle_network;

    // Resolve members: assign paths to this network.
    // A path can belong to multiple networks (e.g. Watts Creek is in both
    // NCC Greenbelt and Capital Pathway). member_of (from _networkRef) is
    // the PRIMARY network (determines URL). But the path also appears in
    // secondary networks' members arrays for display on those pages.
    // If a relation maps to a type: network entry (e.g. Rideau Canal Western
    // became an auto-group), flatten through its non-network members.
    // Also tag existing networks with _superNetworkRef for index grouping.
    for (const relId of network._member_relations || []) {
      const member = byRelation.get(relId);
      if (!member) continue;

      // Long-distance paths are significant rides people plan trips for.
      // They get their own top-level pages, never subordinated under a network.
      if (isLongDistance(member)) continue;

      if (member.type === 'network') {
        // Park networks are NOT intermediaries — don't flatten them.
        // Their members stay primary to the park. Just add them as
        // secondary members of this superroute network.
        if (parkNetworks.has(member)) {
          member._superNetworkRef = networkEntry;
          for (const sub of (member._memberRefs || [])) {
            if (sub.type === 'network') continue;
            if (!networkEntry._memberRefs.includes(sub)) {
              networkEntry._memberRefs.push(sub);
            }
          }
          continue;
        }
        // Flatten: adopt its _memberRefs into this superroute network.
        // Only auto-group networks get flattened — they're intermediaries.
        // byRelation was built at function start, so networks created by
        // earlier iterations of THIS loop won't be in it. Cross-call
        // flattening is prevented by combining all networks into one call.
        for (const sub of [...(member._memberRefs || [])]) {
          if (sub.type === 'network') continue;
          if (sub._networkRef === member || !sub._networkRef) {
            networkEntry._memberRefs.push(sub);
            sub._networkRef = networkEntry;
            if (member._memberRefs) {
              member._memberRefs = member._memberRefs.filter(m => m !== sub);
            }
          } else if (!networkEntry._memberRefs.includes(sub)) {
            // Already in another network — add as secondary member
            // (appears in members array, but member_of stays as-is)
            networkEntry._memberRefs.push(sub);
          }
        }
        // Tag the sub-network with _superNetworkRef (most specific wins —
        // networks are sorted largest-first so smaller overwrites larger)
        member._superNetworkRef = networkEntry;
        // Clean up the flattened auto-group network's way claims
        if (wayRegistry) wayRegistry.remove(member);
        continue;
      }

      if (member._networkRef) {
        const existingNet = member._networkRef;

        // If the member is in a non-park auto-group (no osm_relations),
        // flatten the auto-group into this superroute network.
        if (!parkNetworks.has(existingNet) && !existingNet.osm_relations?.length) {
          for (const sub of [...(existingNet._memberRefs || [])]) {
            if (sub.type === 'network') continue;
            if (sub._networkRef === existingNet || !sub._networkRef) {
              networkEntry._memberRefs.push(sub);
              sub._networkRef = networkEntry;
              if (existingNet._memberRefs) {
                existingNet._memberRefs = existingNet._memberRefs.filter(m => m !== sub);
              }
            } else if (!networkEntry._memberRefs.includes(sub)) {
              networkEntry._memberRefs.push(sub);
            }
          }
          existingNet._superNetworkRef = networkEntry;
          if (wayRegistry) wayRegistry.remove(existingNet);
          continue;
        }

        // Already in a park or superroute network — add as secondary member.
        // Only set _superNetworkRef if this network has wider scope.
        const existingPriority = NET_PRIORITY[existingNet.network] ?? 3;
        const currentPriority = NET_PRIORITY[networkEntry.network] ?? 3;
        if (currentPriority < existingPriority) {
          existingNet._superNetworkRef = networkEntry;
        }
        member._superNetworkRef = networkEntry;
        if (!networkEntry._memberRefs.includes(member)) {
          networkEntry._memberRefs.push(member);
        }
        continue;
      }

      // Park members keep their primary network but join this one too
      if (parkMembers.has(member)) {
        member._superNetworkRef = networkEntry;
        if (!networkEntry._memberRefs.includes(member)) {
          networkEntry._memberRefs.push(member);
        }
        continue;
      }
      networkEntry._memberRefs.push(member);
      member._networkRef = networkEntry;
    }

    // Fallback: adopt orphaned paths with matching operator.
    // Catches paths like Pinecrest Creek (NCC, cycleway) that aren't in
    // the OSM superroute member list but clearly belong to the system.
    if (network.operator) {
      for (const entry of entries) {
        if (entry._networkRef || entry.type === 'network') continue;
        // Operator must match (handles NCC variants)
        const op = entry.operator || '';
        const netOp = network.operator || '';
        if (!op || !netOp) continue;
        // Exact match (case-insensitive) or one is an abbreviation/subset of
        // the other, but require minimum 3 chars to avoid false matches like
        // "City" matching "City of Ottawa Parks"
        const opLower = op.toLowerCase();
        const netLower = netOp.toLowerCase();
        const match = opLower === netLower
          || (netLower.length >= 3 && opLower.includes(netLower))
          || (opLower.length >= 3 && netLower.includes(opLower));
        if (!match) continue;
        // Must be cycling infrastructure
        if (entry.highway !== 'cycleway' && entry.highway !== 'path') continue;
        if (!networkEntry._memberRefs.includes(entry)) {
          networkEntry._memberRefs.push(entry);
          entry._networkRef = networkEntry;
        }
      }
    }

    // Ref matching: orphaned entries sharing a `ref` tag with existing members
    // belong to the same route system. E.g., ref: GPW ties Greenbelt Pathway
    // West (Barrhaven) to the Greenbelt network. More specific than operator.
    const refTags = new Set();
    for (const memberEntry of networkEntry._memberRefs) {
      if (memberEntry.ref) refTags.add(memberEntry.ref);
    }
    if (refTags.size > 0) {
      for (const entry of entries) {
        if (entry._networkRef || entry.type === 'network') continue;
        if (parkMembers.has(entry)) continue;
        if (!entry.ref || !refTags.has(entry.ref)) continue;
        // Exclude roads — they have ref tags (route numbers) that would
        // cause false matches. Allow entries without highway (relation-only).
        const roadHw = ['primary', 'secondary', 'tertiary', 'residential', 'unclassified'];
        if (entry.highway && roadHw.includes(entry.highway)) continue;
        if (!networkEntry._memberRefs.includes(entry)) {
          networkEntry._memberRefs.push(entry);
          entry._networkRef = networkEntry;
          console.log(`    ref match: ${entry.name} (ref: ${entry.ref}) → ${name}`);
        }
      }
    }

    if (networkEntry._memberRefs.length === 0) {
      console.log(`  Skipping superroute network "${name}": no orphaned members`);
      continue;
    }

    entries.push(networkEntry);
    console.log(`  Superroute network: ${name} (${networkEntry._memberRefs.length} members)`);

    // Store metadata for YAML output (slug resolved in final pass)
    const meta = { name, _entryRef: networkEntry };
    if (network.wikidata) meta.wikidata = network.wikidata;
    if (network.operator) meta.operator = network.operator;
    if (network.name_fr) meta.name_fr = network.name_fr;
    if (network.wikidata_meta) meta.wikidata_meta = network.wikidata_meta;
    superNetworkMeta.push(meta);
  }

  return superNetworkMeta;
}

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
 *
 * @param {object} opts
 * @param {Function} opts.queryOverpass — async (q) => { elements: [] }
 * @param {string} opts.bbox — "south,west,north,east"
 * @param {object} opts.adapter — city adapter (from city-adapter.mjs)
 * @param {Array} [opts.manualEntries] — out-of-bounds manual entries
 * @param {Set<string>} [opts.markdownSlugs] — slugs claimed by markdown
 * @param {Map<string, {member_of?: string}>} [opts.markdownOverrides] — frontmatter overrides by slug
 * @returns {Promise<{ entries: Array, superNetworks: Array, slugMap: Map, wayRegistry: WayRegistry }>}
 */
export async function buildBikepathsPipeline({ queryOverpass: qo, bbox: b, adapter: a, manualEntries = [], markdownSlugs = new Set(), markdownOverrides = new Map() }) {
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
  const grouped = await autoGroupNearbyPaths({ entries, markdownSlugs, queryOverpass: qo, bbox: b, wayRegistry });

  // Step 5: Super-network attributes (from OSM superroutes)
  let superNetworks = [];
  let allNetSources = [];
  if (a.discoverNetworks) {
    console.log('Discovering super-networks (OSM superroutes)...');
    const networks = await discoverNetworks({ bbox: b, queryOverpass: qo });
    if (networks.length > 0) {
      // Promoted sub-superroutes (like Ottawa River Pathway) become real
      // network entries with members. Top-level superroutes become attributes.
      const promoted = networks.filter(n => n._promoted);
      allNetSources.push(...networks.filter(n => !n._promoted));

      // Add promoted networks as type: network entries
      for (const net of promoted) {
        const byRelation = new Map();
        for (const entry of grouped) {
          for (const relId of entry.osm_relations ?? []) byRelation.set(relId, entry);
        }
        const memberRefs = [];
        for (const relId of net._member_relations || []) {
          const member = byRelation.get(relId);
          if (member && member.type !== 'network') {
            // Remove from old network's _memberRefs if reassigning
            if (member._networkRef && member._networkRef._memberRefs) {
              member._networkRef._memberRefs = member._networkRef._memberRefs.filter(m => m !== member);
            }
            memberRefs.push(member);
          }
        }
        // Absorb same-named entries and merge same-named auto-group networks.
        // Standalone fragments get _networkRef. Auto-group networks with the
        // same base name (e.g. "Ottawa River Pathway Network") get their
        // _memberRefs transferred and the auto-group network is emptied.
        const netNameLower = net.name.toLowerCase();

        // First: merge any auto-group network with the same base name
        for (const entry of grouped) {
          if (entry.type !== 'network') continue;
          if (entry === net) continue;
          const entryNameLower = entry.name?.toLowerCase().replace(/ (trails|network)$/i, '');
          if (entryNameLower !== netNameLower) continue;
          // Transfer _memberRefs from auto-group network to promoted network
          for (const sub of entry._memberRefs || []) {
            if (!memberRefs.includes(sub)) {
              memberRefs.push(sub);
            }
          }
          entry._memberRefs = []; // will be cleaned up as zombie
          // Clean up the emptied auto-group network's way claims
          if (wayRegistry) wayRegistry.remove(entry);
        }

        // Then: absorb orphaned same-named entries
        for (const entry of grouped) {
          if (entry.type === 'network') continue;
          if (entry._networkRef) continue;
          if (entry.name?.toLowerCase() !== netNameLower) continue;
          if (!memberRefs.includes(entry)) {
            memberRefs.push(entry);
          }
        }

        if (memberRefs.length >= 2) {
          const networkEntry = {
            name: net.name,
            type: 'network',
            _memberRefs: memberRefs,
            osm_relations: net.osm_relations,
          };
          if (net.name_fr) networkEntry.name_fr = net.name_fr;
          if (net.operator) networkEntry.operator = net.operator;
          if (net.wikidata) networkEntry.wikidata = net.wikidata;
          if (net.wikipedia) networkEntry.wikipedia = net.wikipedia;
          grouped.push(networkEntry);
          // Assign _networkRef on all members
          for (const m of memberRefs) {
            m._networkRef = networkEntry;
          }
          console.log(`  Added promoted network: ${net.name} (${memberRefs.length} members)`);
        }
        delete net._promoted;
        delete net._member_relations;
      }

    }

    // Discover route-system networks (e.g. Crosstown Bikeways from cycle_network tags)
    const routeSystemNets = await discoverRouteSystemNetworks({ bbox: b, queryOverpass: qo });
    if (routeSystemNets.length > 0) {
      allNetSources.push(...routeSystemNets);
    }

    // Merge superroute members into route-system networks when they share
    // a cycle_network tag. A superroute like CB2 (cycle_network: CA:ON:Ottawa)
    // is redundant when Ottawa Bikeways already groups by that tag. Merging
    // ensures members like Laurier (which lack their own cycle_network tag)
    // get included in Ottawa Bikeways via the superroute's membership.
    const routeSystemByCN = new Map();
    for (const net of allNetSources) {
      if (net.cycle_network && !net.osm_relations) {
        routeSystemByCN.set(net.cycle_network, net);
      }
    }
    allNetSources = allNetSources.filter(net => {
      if (!net.osm_relations || !net.cycle_network) return true;
      const rsNet = routeSystemByCN.get(net.cycle_network);
      if (!rsNet) return true;
      const existing = new Set(rsNet._member_relations);
      for (const relId of net._member_relations || []) {
        if (!existing.has(relId)) {
          rsNet._member_relations.push(relId);
        }
      }
      console.log(`  Merged superroute "${net.name}" into route-system "${rsNet.name}"`);
      return false;
    });

    // Create all superroute + route-system networks in one call so byRelation
    // is built once. This prevents the second batch from flattening the first.
    if (allNetSources.length > 0) {
      console.log('Creating superroute & route-system networks...');
      superNetworks = addSuperrouteNetworks(grouped, allNetSources, wayRegistry);
    }
  }

  // Step 6: Wikidata enrichment
  console.log('Enriching with Wikidata...');
  const wdCount = await enrichWithWikidata(grouped);
  if (wdCount > 0) console.log(`  Enriched ${wdCount} entries`);

  // Step 7: Complete classification (tier-2/3 MTB + path_type update)
  // Networks now exist from clustering. Tier-2 inherits MTB across networks.
  // Tier-3 labels ambient dirt trails. path_type updated for affected entries.
  const { mtbCount } = classifyPathsLate(grouped);
  if (mtbCount > 0) console.log(`  Labelled ${mtbCount} entries as MTB (tier 2+3)`);

  // Step 7c: Derive entry type (destination/infrastructure/connector)
  // Depends on path_type and _ways (still available, stripped later).
  // Networks already have type: 'network' — deriveEntryType skips them.
  for (const entry of grouped) {
    if (entry.type === 'long-distance') delete entry.type;
    const et = deriveEntryType(entry);
    if (et) entry.type = et;
  }

  // Step 8b: Apply markdown overrides.
  // member_of has special handling (network reassignment). All other fields
  // are simple overwrites — the human value replaces the pipeline value.
  if (markdownOverrides.size > 0) {
    for (const [mdSlug, override] of markdownOverrides) {
      const entry = grouped.find(e => e.type !== 'network' && slugify(e.name) === mdSlug);
      if (!entry) continue;

      // Simple field overwrites (path_type, operator, etc.)
      for (const [field, value] of Object.entries(override)) {
        if (field === 'member_of') continue; // handled below
        entry[field] = value;
      }

      if (!override.member_of) continue;

      const targetNet = grouped.find(e =>
        e.type === 'network' && slugify(e.name) === override.member_of
      );
      if (!targetNet) {
        throw new Error(
          `Markdown override: ${mdSlug} has member_of: "${override.member_of}" ` +
          `but no network with that slug exists. Check ${mdSlug}.md frontmatter.`
        );
      }

      // Remove from old network's _memberRefs
      if (entry._networkRef && entry._networkRef._memberRefs) {
        entry._networkRef._memberRefs = entry._networkRef._memberRefs.filter(m => m !== entry);
      }

      entry._networkRef = targetNet;
      if (!targetNet._memberRefs) targetNet._memberRefs = [];
      if (!targetNet._memberRefs.includes(entry)) {
        targetNet._memberRefs.push(entry);
      }
    }
  }

  // Scrub self-references: a network's _memberRefs must not contain itself
  for (const e of grouped) {
    if (e.type !== 'network' || !e._memberRefs) continue;
    e._memberRefs = e._memberRefs.filter(m => m !== e);
  }

  // Cleanup: remove zombie networks with 0 members (flattened into superroute)
  const zombies = grouped.filter(e => e.type === 'network' && (!e._memberRefs || e._memberRefs.length === 0));
  if (zombies.length > 0) {
    for (const z of zombies) {
      const idx = grouped.indexOf(z);
      if (idx !== -1) grouped.splice(idx, 1);
    }
    console.log(`  Removed ${zombies.length} empty networks`);
  }

  // Step 8d: Process non-cycling relation candidates (before slug computation).
  // 90%+ bikeable → the ways tell us this IS cycling infrastructure. Promote to
  // a real entry — the relation's route tag (hiking, piste) is a fact, not its identity.
  // Below 90% → attach as overlap metadata on existing entries.
  const PROMOTE_THRESHOLD = 0.9;
  if (nonCyclingCandidates.length > 0) {
    const promoted = [];
    const overlapOnly = [];
    for (const c of nonCyclingCandidates) {
      if (c.bikeablePct >= PROMOTE_THRESHOLD) promoted.push(c);
      else overlapOnly.push(c);
    }

    // Promote high-bikeable relations to real entries
    let promotedCount = 0;
    for (const candidate of promoted) {
      const existingEntry = grouped.find(e => e.osm_relations?.includes(candidate.id));
      if (existingEntry) continue;

      const entry = {
        name: candidate.name,
        osm_relations: [candidate.id],
        osm_way_ids: candidate.bikeableWayIds.sort((a, b) => a - b),
        route_type: candidate.route,
      };
      if (candidate.operator) entry.operator = candidate.operator;
      if (candidate.ref) entry.ref = candidate.ref;
      if (candidate.network) entry.network = candidate.network;
      grouped.push(entry);
      wayRegistry.claim(entry, candidate.bikeableWayIds);
      promotedCount++;
    }
    if (promotedCount > 0) {
      console.log(`  Promoted ${promotedCount} non-cycling relations to entries (≥${Math.round(PROMOTE_THRESHOLD * 100)}% bikeable)`);
    }

    // Classify promoted entries — they were added after steps 3b/7/7c.
    // Derive path_type from the cycling entries that own their ways,
    // then derive entry type normally.
    for (const entry of grouped) {
      if (!entry.path_type && entry.route_type) {
        const ptCounts = {};
        for (const wid of (entry.osm_way_ids || [])) {
          const owner = wayRegistry.ownerOf(wid);
          if (owner && owner !== entry && owner.path_type) {
            ptCounts[owner.path_type] = (ptCounts[owner.path_type] || 0) + 1;
          }
        }
        const best = Object.entries(ptCounts).sort((a, b) => b[1] - a[1])[0];
        if (best) entry.path_type = best[0];
      }
      if (!entry.type && entry.type !== 'network') {
        const et = deriveEntryType(entry);
        if (et) entry.type = et;
      }
    }

    // Attach overlap metadata for below-threshold relations
    for (const candidate of overlapOnly) {
      const entrySet = new Set();
      for (const wayId of candidate.bikeableWayIds) {
        for (const [entry, ways] of wayRegistry._entryToWays) {
          if (ways.has(wayId)) entrySet.add(entry);
        }
      }
      for (const entry of entrySet) {
        if (!entry.overlapping_relations) entry.overlapping_relations = [];
        if (!entry.overlapping_relations.some(r => r.id === candidate.id)) {
          entry.overlapping_relations.push({
            id: candidate.id,
            name: candidate.name,
            route: candidate.route,
            operator: candidate.operator,
            ref: candidate.ref,
            network: candidate.network,
          });
        }
      }
    }
    const overlapped = grouped.filter(e => e.overlapping_relations?.length > 0).length;
    if (overlapped > 0) {
      console.log(`  Attached overlap metadata to ${overlapped} entries (below ${Math.round(PROMOTE_THRESHOLD * 100)}%)`);
    }
  }

  // Step 9: Final resolution — compute slugs once, resolve all refs to strings
  // Detach long-distance entries that extend far beyond their network.
  // Short local segments of national trails (TCT Bells Corners, TCT Sussex Drive)
  // stay as members — the pipeline assigned them based on real way overlap.
  // Only truly large trails (>200 ways) get detached.
  const DETACH_WAY_THRESHOLD = 200;
  const detachedEntries = new Set();
  for (const entry of grouped) {
    if (entry.type === 'long-distance' && entry._networkRef) {
      const wayCount = entry._ways?.length ?? 0;
      if (wayCount >= DETACH_WAY_THRESHOLD) {
        const net = entry._networkRef;
        if (net._memberRefs) {
          net._memberRefs = net._memberRefs.filter(m => m !== entry);
        }
        delete entry._networkRef;
        detachedEntries.add(entry);
      }
    }
  }

  const slugMap = computeSlugs(grouped);
  for (const entry of grouped) {
    if (entry._networkRef) {
      entry.member_of = slugMap.get(entry._networkRef);
      delete entry._networkRef;
    }
    if (entry._superNetworkRef) {
      entry.super_network = slugMap.get(entry._superNetworkRef);
      delete entry._superNetworkRef;
    }
    if (entry._memberRefs) {
      entry.members = entry._memberRefs.map(ref => slugMap.get(ref)).filter(Boolean);
      delete entry._memberRefs;
    }
    entry.slug = slugMap.get(entry);
  }

  // Strip member_of from detached long-distance entries (after all resolution)
  for (const entry of detachedEntries) {
    delete entry.member_of;
  }

  // Resolve superNetworks metadata slugs from final slugMap
  for (const meta of superNetworks) {
    if (meta._entryRef) {
      meta.slug = slugMap.get(meta._entryRef);
      delete meta._entryRef;
    }
  }

  // Step 9b: Remove ghost entries — non-relation entries whose ways are
  // mostly owned by relation entries. Two strategies:
  //   1. Structural (preferred): if >=50% of an entry's ways are owned by
  //      other entries that have osm_relations, it's a ghost.
  //   2. Name-based fallback: for entries with no way IDs (parallel lanes,
  //      manual entries), fall back to the old relationBaseNames check.
  {
    const before = grouped.length;
    let structuralCount = 0;
    let nameCount = 0;
    for (let i = grouped.length - 1; i >= 0; i--) {
      const e = grouped[i];
      if (e.type === 'network') continue;
      if (e.osm_relations?.length > 0) continue; // keep relation entries

      const wayIds = wayRegistry.wayIdsFor(e);

      if (wayIds.size > 0) {
        // Strategy 1: structural — check way overlap with relation entries
        let ownedByOthers = 0;
        for (const wid of wayIds) {
          const owner = wayRegistry.ownerOf(wid);
          if (owner && owner !== e && owner.osm_relations?.length > 0) {
            ownedByOthers++;
          }
        }
        if (ownedByOthers / wayIds.size < 0.5) continue; // keep — not a ghost
        structuralCount++;
      } else {
        // Strategy 2: name-based fallback for entries without way IDs
        if (relationBaseNames.size === 0) continue;
        const baseName = e.name?.toLowerCase();
        if (!baseName || !relationBaseNames.has(baseName)) continue;
        nameCount++;
      }

      // Remove the ghost entry
      const slug = e.slug;
      wayRegistry.remove(e);
      grouped.splice(i, 1);
      // Clean up network member references
      for (const net of grouped) {
        if (net.members && slug) {
          const idx = net.members.indexOf(slug);
          if (idx !== -1) net.members.splice(idx, 1);
        }
      }
    }
    if (grouped.length < before) {
      const parts = [];
      if (structuralCount > 0) parts.push(`${structuralCount} by way-overlap`);
      if (nameCount > 0) parts.push(`${nameCount} by name`);
      console.log(`  Removed ${before - grouped.length} ghost entries (${parts.join(', ')})`);
    }
  }

  // Step 9c: Validate — no OSM relation should appear in two entries.
  // Ways can legitimately be in multiple relations (Route Verte 1 and
  // Sentier des Voyageurs share pavement). But each relation is one route
  // and should map to exactly one entry. Duplicates mean the pipeline
  // created two entries for the same relation (the PPJ-style bug).
  {
    const relToEntry = new Map();
    const conflicts = [];
    for (const e of grouped) {
      for (const relId of e.osm_relations ?? []) {
        const prev = relToEntry.get(relId);
        if (prev) {
          conflicts.push({ relId, entries: [prev, e] });
        } else {
          relToEntry.set(relId, e);
        }
      }
    }
    if (conflicts.length > 0) {
      console.warn(`  ⚠ ${conflicts.length} relation(s) appear in multiple entries:`);
      for (const { relId, entries: owners } of conflicts.slice(0, 10)) {
        const names = owners.map(e => e.name || e.slug || '?').join(', ');
        console.warn(`    relation ${relId}: ${names}`);
      }
      if (conflicts.length > 10) console.warn(`    ... and ${conflicts.length - 10} more`);
    }
  }

  // Attach osm_way_ids from the registry to entries (for tests and callers)
  for (const entry of grouped) {
    const wayIds = wayRegistry.wayIdsFor(entry);
    if (wayIds.size > 0) {
      entry.osm_way_ids = [...wayIds].sort((a, b) => a - b);
    }
  }

  // (Non-cycling relation processing moved to step 8d, before slug computation)

  return { entries: grouped, superNetworks, slugMap, wayRegistry };
}

// ---------------------------------------------------------------------------
// main() — thin wrapper: load config, run pipeline, write YAML
// ---------------------------------------------------------------------------

async function main() {
  console.log(`Building bikepaths.yml for ${args.city} (bbox: ${bbox})`);

  const manualEntries = loadManualEntries(dataDir);
  const markdownSlugs = loadMarkdownSlugs(dataDir);
  const bikePathsDir = path.join(dataDir, 'bike-paths');
  const markdownOverrides = parseMarkdownOverrides(bikePathsDir);

  const { entries, superNetworks, slugMap, wayRegistry } = await buildBikepathsPipeline({
    queryOverpass,
    bbox,
    adapter,
    manualEntries,
    markdownSlugs,
    markdownOverrides,
  });

  // Write output
  const networkEntries = entries.filter(e => e.type === 'network');
  const memberEntries = entries.filter(e => e.member_of);
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
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

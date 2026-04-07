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
import { haversineM } from './lib/geo.mjs';
import { slugifyBikePathName as slugify } from '../../src/lib/bike-paths/bikepaths-yml.server.ts';
import { loadCityAdapter } from './lib/city-adapter.mjs';
import { chainSegments } from './lib/chain-segments.mjs';
import { selectBestRoad } from './lib/select-best-road.mjs';
import { defaultParallelLaneFilter } from './lib/city-adapter.mjs';
import { autoGroupNearbyPaths, computeSlugs } from './lib/auto-group.mjs';
import { discoverNetworks, discoverRouteSystemNetworks } from './lib/discover-networks.mjs';
import { enrichWithWikidata } from './lib/wikidata.mjs';
import { classifyPathsEarly, classifyPathsLate } from '../../src/lib/bike-paths/classify-path.ts';
import { deriveEntryType, isLongDistance } from './lib/entry-type.mjs';
import { rankByGeomDistance } from './lib/nearest-park.mjs';
import { WayRegistry } from './lib/way-registry.mjs';

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
// Step 1: Load manual entries from sidecar file
// ---------------------------------------------------------------------------

function loadManualEntries() {
  const manualPath = path.join(dataDir, 'manual-entries.yml');
  if (!fs.existsSync(manualPath)) return [];
  const data = yaml.load(fs.readFileSync(manualPath, 'utf8'));
  const entries = data?.manual_entries || [];
  if (entries.length > 0) {
    console.log(`  Loaded ${entries.length} manual entries`);
  }
  return entries;
}

/**
 * Group chains with the same road name only if their bboxes are within proximityM of each other.
 * Same road name far apart = separate entries.
 */
function groupByRoadAndProximity(results, proximityM) {
  const groups = [];

  for (const r of results) {
    let merged = false;
    for (const g of groups) {
      if (g.roadName !== r.roadName) continue;
      if (bboxDistance(g.bbox, r.chain.bbox) <= proximityM) {
        g.chains.push(r.chain);
        g.allTags.push(...r.chain.tags);
        g.bbox = mergeBboxes(g.bbox, r.chain.bbox);
        merged = true;
        break;
      }
    }
    if (!merged) {
      groups.push({
        roadName: r.roadName,
        chains: [r.chain],
        allTags: [...r.chain.tags],
        bbox: { ...r.chain.bbox },
      });
    }
  }

  return groups.map(g => ({
    name: g.roadName,
    parallel_to: g.roadName,
    anchors: [
      [g.bbox.west, g.bbox.south],
      [g.bbox.east, g.bbox.north],
    ],
    tags: mergeWayTags(g.allTags.map((t, i) => ({ tags: t, id: i }))),
    _chainCoords: g.chains.flatMap(c =>
      c.tags.map((_, i) => [c.midpoint.lat, c.midpoint.lon])
    ),
  }));
}

function bboxDistance(a, b) {
  if (a.south <= b.north && a.north >= b.south && a.west <= b.east && a.east >= b.west) return 0;
  const latA = (a.south + a.north) / 2;
  const lngA = (a.west + a.east) / 2;
  const latB = (b.south + b.north) / 2;
  const lngB = (b.west + b.east) / 2;
  return haversineM([lngA, latA], [lngB, latB]);
}

function mergeBboxes(a, b) {
  return {
    south: Math.min(a.south, b.south),
    north: Math.max(a.north, b.north),
    west: Math.min(a.west, b.west),
    east: Math.max(a.east, b.east),
  };
}

// ---------------------------------------------------------------------------
// Metadata helpers
// ---------------------------------------------------------------------------

/**
 * Extract useful OSM tags into structured metadata for bikepaths.yml.
 * Only includes fields that have values — no nulls or empty strings.
 */
function extractOsmMetadata(tags) {
  if (!tags) return {};
  const meta = {};

  // Bilingual names
  if (tags['name:fr']) meta.name_fr = tags['name:fr'];
  if (tags['name:en']) meta.name_en = tags['name:en'];
  if (tags.alt_name) meta.alt_name = tags.alt_name;

  // External references
  if (tags.wikipedia) meta.wikipedia = tags.wikipedia;
  if (tags.wikidata) meta.wikidata = tags.wikidata;
  if (tags.wikimedia_commons) meta.wikimedia_commons = tags.wikimedia_commons;
  if (tags.website || tags['contact:website']) meta.website = tags.website || tags['contact:website'];

  // Physical characteristics
  if (tags.surface) meta.surface = tags.surface;
  if (tags.smoothness) meta.smoothness = tags.smoothness;
  if (tags.width) {
    const w = parseFloat(tags.width);
    if (isNaN(w)) {
      console.warn(`  ⚠ width "${tags.width}" unparseable — ${tags.name || 'unnamed'}`);
    } else if (w < 0.3) {
      console.warn(`  ⚠ width ${w}m suspiciously narrow — ${tags.name || 'unnamed'}`);
    } else if (w > 6) {
      console.warn(`  ⚠ width ${w}m likely road width, not bike lane — ${tags.name || 'unnamed'}`);
    }
    meta.width = tags.width;
  }
  if (tags.lit) meta.lit = tags.lit;
  if (tags.incline) meta.incline = tags.incline;

  // Cycling infrastructure type
  if (tags.segregated) meta.segregated = tags.segregated;
  if (tags.cycleway) meta.cycleway = tags.cycleway;
  if (tags.highway) meta.highway = tags.highway;
  if (tags.tracktype) meta.tracktype = tags.tracktype;
  if (tags['mtb:scale'] != null) meta['mtb:scale'] = tags['mtb:scale'];
  if (tags['mtb:scale:imba'] != null) meta['mtb:scale:imba'] = tags['mtb:scale:imba'];
  if (tags.bicycle) meta.bicycle = tags.bicycle;

  // Network and management
  if (tags.operator) meta.operator = tags.operator;
  if (tags.network) meta.network = tags.network;
  if (tags.ref) meta.ref = tags.ref;
  if (tags.cycle_network) meta.cycle_network = tags.cycle_network;

  // Route info (relations)
  if (tags.distance) meta.distance = tags.distance;
  if (tags.description) meta.description = tags.description;

  // Seasonal / access
  if (tags.opening_hours) meta.opening_hours = tags.opening_hours;
  if (tags.seasonal) meta.seasonal = tags.seasonal;
  if (tags.access) meta.access = tags.access;

  // Pedestrian access and facility type (for facts engine)
  if (tags.foot) meta.foot = tags.foot;
  if (tags.sport) meta.sport = tags.sport;

  return meta;
}

/**
 * For named ways grouped by name, pick the most common value for each tag
 * across all ways in the group.
 */
function mergeWayTags(ways) {
  const tagCounts = {};
  for (const way of ways) {
    const tags = way.tags || {};
    for (const [key, val] of Object.entries(tags)) {
      if (!tagCounts[key]) tagCounts[key] = {};
      tagCounts[key][val] = (tagCounts[key][val] || 0) + 1;
    }
  }
  // Pick the most common value for each tag
  const merged = {};
  for (const [key, vals] of Object.entries(tagCounts)) {
    let bestVal = null, bestCount = 0;
    for (const [val, count] of Object.entries(vals)) {
      if (count > bestCount) { bestCount = count; bestVal = val; }
    }
    merged[key] = bestVal;
  }
  return merged;
}

// Identity tags describe the entity (route, bridge, road) — not physical
// infrastructure. When merging way tags into a relation entry, these must
// be skipped because a way's identity (e.g. Adàwe Crossing bridge) is not
// the route's identity (Crosstown Bikeway 3).
const IDENTITY_TAGS = new Set([
  'name_fr', 'name_en', 'alt_name',
  'wikidata', 'wikipedia', 'wikimedia_commons',
  'operator', 'network', 'ref', 'cycle_network',
  'distance', 'description',
]);

/**
 * Enrich an entry with OSM metadata, only adding fields it doesn't
 * already have (hand-edited values take precedence).
 *
 * @param {object} entry — the entry to enrich
 * @param {object} tags — OSM tags to merge in
 * @param {object} [opts]
 * @param {boolean} [opts.skipIdentity] — if true, skip identity tags
 *   (use when merging way-level tags into a relation entry)
 */
function enrichEntry(entry, tags, { skipIdentity = false } = {}) {
  const meta = extractOsmMetadata(tags);
  for (const [key, val] of Object.entries(meta)) {
    if (entry[key] == null) {
      if (skipIdentity && IDENTITY_TAGS.has(key)) continue;
      entry[key] = val;
    }
  }
}

// ---------------------------------------------------------------------------
/**
 * Split ways with the same name into connected components.
 * "Trail 20" in the Greenbelt and "Trail 20" in Gatineau Park are
 * different trails — they share a name but have no geometric connection.
 * OVRT is one 30km trail — its ways chain continuously via shared nodes.
 *
 * Uses real geometry: shared OSM nodes first, then endpoint proximity
 * (100m tolerance) as a fallback for mapping gaps. Never midpoints.
 */
const ENDPOINT_SNAP_M = 100;

function splitWaysByConnectivity(ways) {
  if (ways.length <= 1) return [ways];

  // Union-find
  const parent = ways.map((_, i) => i);
  function find(i) {
    while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
    return i;
  }
  function union(a, b) {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }

  // Phase 1: merge ways that share an OSM node
  const nodeToWay = new Map();
  for (let i = 0; i < ways.length; i++) {
    for (const nodeId of ways[i].nodes || []) {
      if (nodeToWay.has(nodeId)) {
        union(i, nodeToWay.get(nodeId));
      } else {
        nodeToWay.set(nodeId, i);
      }
    }
  }

  // Phase 2: merge ways whose endpoints are within ENDPOINT_SNAP_M
  // Uses real endpoint coordinates from geometry, not midpoints.
  const endpoints = ways.map(w => {
    if (!w.geometry?.length) return null;
    const g = w.geometry;
    return [
      { lat: g[0].lat, lon: g[0].lon },
      { lat: g[g.length - 1].lat, lon: g[g.length - 1].lon },
    ];
  });

  for (let i = 0; i < ways.length; i++) {
    if (!endpoints[i]) continue;
    for (let j = i + 1; j < ways.length; j++) {
      if (!endpoints[j]) continue;
      if (find(i) === find(j)) continue;
      // Check all 4 endpoint pairs
      for (const a of endpoints[i]) {
        for (const b of endpoints[j]) {
          const dlat = (a.lat - b.lat) * 111320;
          const dlng = (a.lon - b.lon) * 111320 * Math.cos(a.lat * Math.PI / 180);
          if (dlat * dlat + dlng * dlng < ENDPOINT_SNAP_M * ENDPOINT_SNAP_M) {
            union(i, j);
          }
        }
      }
    }
  }

  // Phase 3: merge components whose real geometry bounding boxes are
  // within 2km. Catches road bike lanes with intersection gaps — the
  // segments are disconnected but clearly the same road facility.
  // Uses bbox edges (real geometry extent), not midpoints or centers.
  const BBOX_MERGE_M = 2000;
  const bboxOf = (indices) => {
    let s = Infinity, n = -Infinity, w = Infinity, e = -Infinity;
    for (const i of indices) {
      for (const pt of ways[i].geometry || []) {
        if (pt.lat < s) s = pt.lat;
        if (pt.lat > n) n = pt.lat;
        if (pt.lon < w) w = pt.lon;
        if (pt.lon > e) e = pt.lon;
      }
    }
    return { s, n, w, e };
  };
  const components = new Map();
  for (let i = 0; i < ways.length; i++) {
    const root = find(i);
    if (!components.has(root)) components.set(root, []);
    components.get(root).push(i);
  }
  const roots = [...components.keys()];
  const bboxes = new Map(roots.map(r => [r, bboxOf(components.get(r))]));
  for (let i = 0; i < roots.length; i++) {
    for (let j = i + 1; j < roots.length; j++) {
      if (find(roots[i]) === find(roots[j])) continue;
      const a = bboxes.get(roots[i]), b = bboxes.get(roots[j]);
      // Min distance between bbox edges (not centers)
      const latGap = Math.max(0, Math.max(a.s, b.s) - Math.min(a.n, b.n)) * 111320;
      const lonGap = Math.max(0, Math.max(a.w, b.w) - Math.min(a.e, b.e)) * 111320 *
        Math.cos(((a.s + a.n) / 2) * Math.PI / 180);
      if (Math.sqrt(latGap * latGap + lonGap * lonGap) < BBOX_MERGE_M) {
        union(roots[i], roots[j]);
      }
    }
  }

  const groups = new Map();
  for (let i = 0; i < ways.length; i++) {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(ways[i]);
  }
  return [...groups.values()];
}

// Step 5: Build entries from scratch (replaces mergeData)
// ---------------------------------------------------------------------------

/**
 * Build entries from discovered OSM data and manual entries.
 * No reference to any existing bikepaths.yml — built from scratch.
 */
function buildEntries(osmRelations, osmNamedWays, parallelLanes, manualEntries, wayRegistry) {
  console.log('Building entries from scratch...');

  const bySlug = new Map();
  const byRelation = new Map();
  const byName = new Map();
  const result = [];

  // Add manual entries first
  for (const entry of manualEntries) {
    const slug = slugify(entry.name);
    bySlug.set(slug, entry);
    byName.set(entry.name.toLowerCase(), entry);
    result.push(entry);
    if (entry.osm_relations) {
      for (const relId of entry.osm_relations) byRelation.set(relId, entry);
    }
  }

  // Add OSM relations
  for (const rel of osmRelations) {
    if (byRelation.has(rel.id)) {
      enrichEntry(byRelation.get(rel.id), rel.tags);
      continue;
    }
    const slug = slugify(rel.name);
    if (bySlug.has(slug)) {
      const entry = bySlug.get(slug);
      if (!entry.osm_relations) entry.osm_relations = [];
      entry.osm_relations.push(rel.id);
      enrichEntry(entry, rel.tags);
      byRelation.set(rel.id, entry);
      continue;
    }

    const meta = extractOsmMetadata(rel.tags);
    const entry = {
      name: rel.name,
      osm_relations: [rel.id],
      ...meta,
    };
    result.push(entry);
    bySlug.set(slug, entry);
    byRelation.set(rel.id, entry);
    byName.set(rel.name.toLowerCase(), entry);
  }

  // Enrich relation entries with aggregated way-level tags.
  // Route relations lack physical characteristics (highway, surface, width,
  // lit) — those live on member ways. enrichEntry() only sets missing fields,
  // so explicit relation-level tags take precedence.
  for (const rel of osmRelations) {
    if (rel._aggregatedWayTags) {
      const entry = byRelation.get(rel.id);
      if (entry) enrichEntry(entry, rel._aggregatedWayTags, { skipIdentity: true });
    }
  }

  // Tag all relation-sourced entries with provenance
  for (const entry of byRelation.values()) {
    entry._discovery_source = 'relation';
  }

  // Register relation member way IDs in the WayRegistry
  for (const rel of osmRelations) {
    if (rel._memberWayIds?.length > 0) {
      const entry = byRelation.get(rel.id);
      if (entry) wayRegistry.claim(entry, rel._memberWayIds);
    }
  }

  // Add named ways
  for (const np of osmNamedWays) {
    // Check if this named-way group's ways are already claimed by a relation
    const npWayIds = np._wayIds || [];
    if (npWayIds.length > 0) {
      const overlap = wayRegistry.overlapWith(npWayIds);
      if (overlap.size > 0) {
        let bestEntry = null, bestCount = 0;
        for (const [entry, sharedIds] of overlap) {
          if (sharedIds.size > bestCount) { bestEntry = entry; bestCount = sharedIds.size; }
        }
        const overlapRatio = bestCount / npWayIds.length;
        if (overlapRatio >= 0.4 && bestEntry) {
          enrichEntry(bestEntry, np.tags, { skipIdentity: !!bestEntry.osm_relations?.length });
          if (np.anchors?.length > (bestEntry.anchors?.length || 0)) bestEntry.anchors = np.anchors;
          if (np._ways) bestEntry._ways = np._ways;
          const unclaimed = npWayIds.filter(id => !wayRegistry.isClaimed(id));
          if (unclaimed.length > 0) wayRegistry.claim(bestEntry, unclaimed);
          continue;
        }
      }
    }

    const slug = slugify(np.name);
    const existing = bySlug.get(slug) || byName.get(np.name.toLowerCase());
    if (existing) {
      // Don't merge entries that are far apart — they're different trails
      // with the same slug. E.g., "Trail 24" (Greenbelt, 45.30°N) and
      // "Trail #24" (Gatineau Park, 45.52°N) both slug to trail-24.
      // EXCEPTION: always merge into a relation entry with the same name.
      // Relations are authoritative — a trail with a gap in the middle
      // (Voie Verte Chelsea) should still be one entry.
      const hasRelation = existing.osm_relations?.length > 0;
      const tooFar = !hasRelation &&
        existing.anchors?.length > 0 && np.anchors?.length > 0 &&
        haversineM(existing.anchors[0], np.anchors[0]) > 5000;
      if (tooFar) {
        // Different trail, same slug — create separate entry (slug will be disambiguated later)
        const meta = extractOsmMetadata(np.tags);
        const entry = { name: np.name, osm_names: np.osmNames, anchors: np.anchors, _ways: np._ways, ...meta };
        entry._discovery_source = np._isUnnamedChain ? 'unnamed-chain' : 'named-way';
        result.push(entry);
        continue;
      }
      enrichEntry(existing, np.tags, { skipIdentity: !!existing.osm_relations?.length });
      if (np.anchors?.length > (existing.anchors?.length || 0)) existing.anchors = np.anchors;
      if (np._ways) existing._ways = np._ways;
      if (!existing.osm_names) {
        existing.osm_names = np.osmNames;
      }
      continue;
    }

    const meta = extractOsmMetadata(np.tags);
    const entry = {
      name: np.name,
      osm_names: np.osmNames,
      anchors: np.anchors,
      _ways: np._ways,
      ...meta,
    };
    entry._discovery_source = np._isUnnamedChain ? 'unnamed-chain' : 'named-way';
    result.push(entry);
    bySlug.set(slug, entry);
    byName.set(np.name.toLowerCase(), entry);
    if (npWayIds.length > 0) wayRegistry.claim(entry, npWayIds);
  }

  // Add parallel lanes
  let parallelAdded = 0;
  let parallelMerged = 0;
  for (const candidate of parallelLanes) {
    const slug = slugify(candidate.name);
    const existingEntry = bySlug.get(slug) || byName.get(candidate.name.toLowerCase());
    if (existingEntry) {
      if (!existingEntry.parallel_to) {
        existingEntry.parallel_to = candidate.parallel_to;
        parallelMerged++;
        console.log(`  ~ merged parallel geometry into: ${existingEntry.name}`);
      }
      continue;
    }

    const entry = {
      name: candidate.name,
      parallel_to: candidate.parallel_to,
      highway: candidate.tags.highway || 'cycleway',
      anchors: candidate.anchors,
    };
    for (const key of ['surface', 'lit', 'width', 'smoothness']) {
      if (candidate.tags[key]) entry[key] = candidate.tags[key];
    }
    entry._discovery_source = 'parallel-lane';
    result.push(entry);
    bySlug.set(slug, entry);
    byName.set(candidate.name.toLowerCase(), entry);
    parallelAdded++;
    console.log(`  + parallel lane: ${candidate.name}`);
  }

  if (parallelAdded > 0 || parallelMerged > 0) {
    console.log(`  Parallel lanes added: ${parallelAdded}, merged into existing: ${parallelMerged}`);
  }

  console.log(`  Built ${result.length} entries from scratch`);
  return result;
}

// ---------------------------------------------------------------------------
// Enrich out-of-bounds relations
// ---------------------------------------------------------------------------

/**
 * Enrich manually added entries whose osm_relations were not found by the
 * bbox-scoped discovery query. Fetches tags directly by relation ID.
 * This is what makes manual one-offs work: add a relation ID to the file,
 * and the next script run fills in name, surface, network, etc. from OSM.
 */
async function enrichOutOfBoundsRelations(entries, discoveredRelationIds) {
  const missing = [];
  for (const entry of entries) {
    for (const relId of entry.osm_relations ?? []) {
      if (!discoveredRelationIds.has(relId)) {
        missing.push({ relId, entry });
      }
    }
  }
  if (missing.length === 0) return;

  console.log(`Enriching ${missing.length} out-of-bounds relations...`);
  const relIds = missing.map(m => m.relId);
  const q = `[out:json][timeout:60];\n(\n${relIds.map(id => `  relation(${id});`).join('\n')}\n);\nout tags;`;
  try {
    const data = await queryOverpass(q);
    const byId = new Map(data.elements.map(el => [el.id, el.tags || {}]));
    for (const { relId, entry } of missing) {
      const tags = byId.get(relId);
      if (tags) {
        enrichEntry(entry, tags);
        console.log(`  Enriched: ${entry.name} (relation ${relId})`);
      }
    }
  } catch (err) {
    console.error(`  Failed to enrich out-of-bounds relations: ${err.message}`);
  }
}

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
// Helper: load markdown slugs
// ---------------------------------------------------------------------------

function loadMarkdownSlugs() {
  const bikePathsDir = path.join(dataDir, 'bike-paths');
  const slugs = new Set();
  if (fs.existsSync(bikePathsDir)) {
    for (const f of fs.readdirSync(bikePathsDir)) {
      if (!f.endsWith('.md') || f.includes('.fr.')) continue;
      slugs.add(f.replace(/\.md$/, ''));
      // Parse includes from frontmatter — claims those slugs too
      try {
        const content = fs.readFileSync(path.join(bikePathsDir, f), 'utf8');
        const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
        if (fmMatch) {
          const includes = fmMatch[1].match(/includes:\n((?:\s+-\s+.+\n?)*)/);
          if (includes) {
            for (const line of includes[1].split('\n')) {
              const slug = line.replace(/^\s+-\s+/, '').trim();
              if (slug) slugs.add(slug);
            }
          }
        }
      } catch {}
    }
  }
  return slugs;
}

/**
 * Parse markdown frontmatter overrides into a structured map.
 * Currently supports: member_of.
 */
// Fields that markdown frontmatter can override on bikepaths.yml entries.
// member_of has special handling (network reassignment). Everything else
// is a simple field overwrite — if a human puts it in markdown, it wins.
const MARKDOWN_OVERRIDE_FIELDS = [
  'member_of', 'operator', 'path_type', 'type',
];

export function parseMarkdownOverrides(bikePathsDir) {
  const overrides = new Map();
  if (!bikePathsDir || !fs.existsSync(bikePathsDir)) return overrides;
  for (const f of fs.readdirSync(bikePathsDir).filter(f => f.endsWith('.md') && !f.includes('.fr.'))) {
    const content = fs.readFileSync(path.join(bikePathsDir, f), 'utf8');
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) continue;
    let fm;
    try { fm = yaml.load(fmMatch[1]); } catch { continue; }
    const mdSlug = f.replace('.md', '');
    const override = {};
    for (const field of MARKDOWN_OVERRIDE_FIELDS) {
      if (fm?.[field] != null) override[field] = fm[field];
    }
    if (Object.keys(override).length > 0) overrides.set(mdSlug, override);
  }
  return overrides;
}

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
  // Step 1: Discover cycling relations
  console.log('Discovering cycling relations from OSM...');
  const relQ = `[out:json][timeout:120];
(
  relation["route"="bicycle"](${b});
  relation["route"="mtb"](${b});
  relation["type"="route"]["name"~"${a.relationNamePattern}"](${b});
);
out tags;`;
  const relData = await qo(relQ);
  const osmRelations = relData.elements
    .filter(el => el.tags?.type !== 'superroute') // superroutes are containers, handled by network discovery
    .map(el => ({
      id: el.id,
      name: el.tags?.name || `relation-${el.id}`,
      tags: el.tags || {},
    }));
  console.log(`  Found ${osmRelations.length} cycling relations`);

  // Step 1a: Fetch member way IDs for each relation (for structural dedup).
  // The discovery query above uses `out tags;` which only returns tags.
  // We need `out body;` to get member lists with way IDs.
  const wayRegistry = new WayRegistry();
  if (osmRelations.length > 0) {
    const relIds = osmRelations.map(r => r.id);
    const bodyQ = `[out:json][timeout:120];\n(\n${relIds.map(id => `  relation(${id});`).join('\n')}\n);\nout body;`;
    try {
      const bodyData = await qo(bodyQ);
      const bodyById = new Map();
      for (const el of bodyData.elements) {
        if (el.members) bodyById.set(el.id, el.members);
      }
      for (const rel of osmRelations) {
        const members = bodyById.get(rel.id);
        if (members) {
          rel._memberWayIds = members.filter(m => m.type === 'way').map(m => m.ref);
        }
      }
      const totalWays = osmRelations.reduce((n, r) => n + (r._memberWayIds?.length || 0), 0);
      console.log(`  Fetched member way IDs: ${totalWays} ways across ${bodyById.size} relations`);
    } catch (err) {
      console.error(`  Failed to fetch relation member way IDs: ${err.message}`);
    }
  }

  // Step 1a-2: Fetch way-level tags for relation members.
  // Route relations typically lack physical tags (highway, surface, width,
  // lit) — those live on the member ways. Aggregate them via majority vote
  // so relation entries get correct classification in derivePathType().
  if (osmRelations.length > 0) {
    const wayIdToRels = new Map();
    for (const rel of osmRelations) {
      for (const wid of (rel._memberWayIds || [])) {
        if (!wayIdToRels.has(wid)) wayIdToRels.set(wid, []);
        wayIdToRels.get(wid).push(rel);
      }
    }
    const allWayIds = [...wayIdToRels.keys()];
    if (allWayIds.length > 0) {
      const wayTagQ = `[out:json][timeout:120];\nway(id:${allWayIds.join(',')});\nout tags;`;
      try {
        const wayTagData = await qo(wayTagQ);
        const waysByRel = new Map();
        for (const el of wayTagData.elements) {
          const rels = wayIdToRels.get(el.id);
          if (!rels) continue;
          for (const rel of rels) {
            if (!waysByRel.has(rel.id)) waysByRel.set(rel.id, []);
            waysByRel.get(rel.id).push(el);
          }
        }
        let enrichedCount = 0;
        for (const rel of osmRelations) {
          const ways = waysByRel.get(rel.id);
          if (ways?.length > 0) {
            rel._aggregatedWayTags = mergeWayTags(ways);
            enrichedCount++;
          }
        }
        console.log(`  Aggregated way-level tags for ${enrichedCount} relations`);
      } catch (err) {
        console.error(`  Failed to fetch way-level tags: ${err.message}`);
      }
    }
  }

  // Step 1b: Resolve relation base names for ghost entry removal in step 8c.
  // Named ways sometimes duplicate relation entries (e.g. "Ottawa River Pathway"
  // ways create ghost entries alongside "Ottawa River Pathway (east)" relations).
  // We collect the base names here and remove the ghosts after the full pipeline.
  const relationBaseNames = new Set(osmRelations.map(r =>
    r.name.replace(/\s*\(.*?\)\s*$/, '').toLowerCase()
  ));

  // Step 2: Discover named cycling ways (with junction trail expansion)
  console.log('Discovering named cycling ways from OSM...');
  const namedWayQueries = a.namedWayQueries(b);
  const allWayElements = [];
  for (const { label, q } of namedWayQueries) {
    try {
      const data = await qo(q);
      console.log(`  ${label}: ${data.elements.length} ways`);
      allWayElements.push(...data.elements);
    } catch (err) {
      console.error(`  ${label}: failed (${err.message})`);
    }
  }

  const waysByName = new Map();
  for (const el of allWayElements) {
    const name = el.tags?.name;
    if (!name) continue;
    if (!waysByName.has(name)) waysByName.set(name, []);
    waysByName.get(name).push(el);
  }

  // Fetch non-cycling junction ways that share nodes with cycling ways.
  // Trails in parks connect through hiking-only segments (bicycle:no).
  const cyclingWayIds = allWayElements.filter(e => e.id).map(e => e.id);
  const allWaysByName = new Map();
  if (cyclingWayIds.length > 0) {
    const junctionQ = `[out:json][timeout:180];
way(id:${cyclingWayIds.join(',')});
node(w);
way(bn)["name"]["highway"~"path|footway|cycleway"](${b});
out geom tags;`;
    try {
      const junctionData = await qo(junctionQ);
      const cyclingIdSet = new Set(cyclingWayIds);
      for (const el of junctionData.elements) {
        if (el.type !== 'way') continue;
        if (cyclingIdSet.has(el.id)) continue;
        const name = el.tags?.name;
        if (!name) continue;
        if (!allWaysByName.has(name)) allWaysByName.set(name, []);
        allWaysByName.get(name).push(el);
      }

      let junctionCount = 0;
      for (const [name, ways] of allWaysByName) {
        if (waysByName.has(name)) continue;
        const anchors = [];
        for (const w of ways) {
          if (w.geometry?.length >= 2) {
            anchors.push([w.geometry[0].lon, w.geometry[0].lat]);
            anchors.push([w.geometry[w.geometry.length - 1].lon, w.geometry[w.geometry.length - 1].lat]);
          }
        }
        if (anchors.length > 0) {
          waysByName.set(name, ways);
          junctionCount++;
        }
      }
      if (junctionCount > 0) console.log(`  Found ${junctionCount} non-cycling junction trails`);
    } catch (err) {
      console.error(`  Junction ways fetch failed: ${err.message}`);
    }
  }

  // Build named way entries. Split same-named ways that are geographically
  // far apart — "Trail 20" in the Greenbelt (45.32°N) and "Trail 20" in
  // Gatineau Park (45.52°N) are different trails that happen to share a name.
  const osmNamedWays = [];
  for (const [name, ways] of waysByName) {
    // Split same-named ways into connected components using real geometry.
    // Shared OSM nodes + 100m endpoint snap. OVRT (one continuous trail)
    // stays one entry. Trail 20 in different parks stays separate.
    const wayClusters = splitWaysByConnectivity(ways);

    for (const clusterWays of wayClusters) {
      const anchors = [];
      for (const w of clusterWays) {
        if (w.geometry?.length >= 2) {
          anchors.push([w.geometry[0].lon, w.geometry[0].lat]);
          anchors.push([w.geometry[w.geometry.length - 1].lon, w.geometry[w.geometry.length - 1].lat]);
        } else if (w.center) {
          anchors.push([w.center.lon, w.center.lat]);
        }
      }
      if (anchors.length === 0) continue;

      // Include junction ways that share nodes or have endpoints near
      // THIS cluster's ways (not all junction ways with the same name).
      const clusterNodeIds = new Set(clusterWays.flatMap(w => w.nodes || []));
      const junctionWays = (allWaysByName.get(name) || []).filter(jw => {
        // Shared nodes
        if (jw.nodes?.some(n => clusterNodeIds.has(n))) return true;
        // Endpoint proximity (100m)
        if (!jw.geometry?.length) return false;
        const jwEps = [jw.geometry[0], jw.geometry[jw.geometry.length - 1]];
        for (const cw of clusterWays) {
          if (!cw.geometry?.length) continue;
          const cwEps = [cw.geometry[0], cw.geometry[cw.geometry.length - 1]];
          for (const a of jwEps) {
            for (const b of cwEps) {
              const dlat = (a.lat - b.lat) * 111320;
              const dlng = (a.lon - b.lon) * 111320 * Math.cos(a.lat * Math.PI / 180);
              if (dlat * dlat + dlng * dlng < 10000) return true; // 100m
            }
          }
        }
        return false;
      });

      const seenIds = new Set();
      const combinedWays = [];
      for (const w of [...clusterWays, ...junctionWays]) {
        if (!w.geometry?.length || w.geometry.length < 2) continue;
        if (w.id && seenIds.has(w.id)) continue;
        if (w.id) seenIds.add(w.id);
        combinedWays.push(w.geometry);
      }

      osmNamedWays.push({
        name,
        wayCount: clusterWays.length,
        tags: mergeWayTags(clusterWays),
        anchors,
        osmNames: [name],
        _ways: combinedWays.length > 0 ? combinedWays : clusterWays.filter(w => w.geometry?.length >= 2).map(w => w.geometry),
        _wayIds: clusterWays.filter(w => w.id).map(w => w.id),
      });
    }
  }
  // Token-based name similarity for fragment merging.
  // Tokenize, hard-reject on numeric mismatch, soft Dice with edit-distance-1 tolerance.
  function namesAreSimilar(a, b) {
    const tokenize = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/\(.*?\)/g, '').match(/[a-z0-9]+/g) || [];
    const editDist1 = (s, t) => {
      if (Math.abs(s.length - t.length) > 1) return false;
      let diffs = 0;
      if (s.length === t.length) {
        for (let i = 0; i < s.length; i++) { if (s[i] !== t[i]) diffs++; }
        return diffs === 1;
      }
      // length differs by 1 — check for single insertion
      const [short, long] = s.length < t.length ? [s, t] : [t, s];
      let si = 0;
      for (let li = 0; li < long.length; li++) {
        if (short[si] === long[li]) si++;
        else diffs++;
        if (diffs > 1) return false;
      }
      return true;
    };

    const tokA = tokenize(a), tokB = tokenize(b);
    if (tokA.length < 2 || tokB.length < 2) return false;

    // Hard reject: if any numeric token in A has no match in B
    const numA = tokA.filter(t => /^\d+$/.test(t));
    const numB = tokB.filter(t => /^\d+$/.test(t));
    if (numA.length > 0 || numB.length > 0) {
      if (numA.sort().join(',') !== numB.sort().join(',')) return false;
    }

    // Soft Dice: tokens match if identical or (both >= 4 chars and edit distance 1)
    const usedB = new Set();
    let matched = 0;
    for (const ta of tokA) {
      for (let j = 0; j < tokB.length; j++) {
        if (usedB.has(j)) continue;
        const tb = tokB[j];
        if (ta === tb || (ta.length >= 4 && tb.length >= 4 && editDist1(ta, tb))) {
          matched++;
          usedB.add(j);
          break;
        }
      }
    }
    const dice = (2 * matched) / (tokA.length + tokB.length);
    return dice >= 0.85 && matched >= 2;
  }

  // Merge small fragments into nearby larger entries with similar names.
  // "Voie Verte de Chelsea" (0.2km) is a typo variant of "Voie Verte Chelsea"
  // (22km). Relative to the trail length, the fragment is insignificant.
  // Absorb it: merge its _ways into the larger entry and drop it.
  const absorbed = new Set();
  for (let i = 0; i < osmNamedWays.length; i++) {
    const small = osmNamedWays[i];
    if (absorbed.has(i)) continue;
    for (let j = 0; j < osmNamedWays.length; j++) {
      if (i === j || absorbed.has(j)) continue;
      const large = osmNamedWays[j];
      if (large.wayCount <= small.wayCount) continue; // large must be bigger

      // Skip exact same name — splitWaysByConnectivity already decided
      // these are different trails in different parks.
      if (small.name === large.name) continue;
      if (slugify(small.name) === slugify(large.name)) continue;

      // Token-based soft Dice similarity (Codex recommendation).
      // Language-agnostic, handles typos (vert/verte), particles (de/du),
      // parentheticals. Hard rejects numeric token mismatches (Trail 22 ≠ Trail 24).
      if (!namesAreSimilar(small.name, large.name)) continue;

      // Geographically close?
      if (!small.anchors?.length || !large.anchors?.length) continue;
      if (haversineM(small.anchors[0], large.anchors[0]) > 10000) continue;

      // Small relative to large? (< 20% way count)
      if (small.wayCount > large.wayCount * 0.2) continue;

      // Absorb: merge small's _ways into large, drop small
      large._ways = [...(large._ways || []), ...(small._ways || [])];
      large.anchors = [...large.anchors, ...small.anchors];
      absorbed.add(i);
      break;
    }
  }
  if (absorbed.size > 0) {
    const before = osmNamedWays.length;
    for (const idx of [...absorbed].sort((a, b) => b - a)) {
      osmNamedWays.splice(idx, 1);
    }
    console.log(`  Merged ${absorbed.size} small fragments into larger entries (${before} → ${osmNamedWays.length})`);
  }

  console.log(`  Found ${osmNamedWays.length} named cycling ways`);

  // Step 2b: Discover unnamed parallel bike lanes
  console.log('Discovering unnamed parallel bike lanes...');
  const filter = (a.parallelLaneFilter || defaultParallelLaneFilter);
  const plQ = `[out:json][timeout:120];
way["highway"="cycleway"][!"name"][!"crossing"](${b});
out tags center;`;
  const plData = await qo(plQ);
  const plCandidates = plData.elements.filter(el => filter(el.tags || {}));
  let parallelLanes = [];
  if (plCandidates.length > 0) {
    const segments = plCandidates.map(el => ({ id: el.id, center: el.center, tags: el.tags || {} }));
    const chains = chainSegments(segments, 50);
    const results = [];
    for (const chain of chains) {
      const { lat, lon } = chain.midpoint;
      const roadQ = `[out:json][timeout:15];
way["highway"~"^(primary|secondary|tertiary|residential|unclassified)$"]["name"]
  (around:30,${lat},${lon});
out tags center;`;
      try {
        const roadData = await qo(roadQ);
        if (roadData.elements.length === 0) continue;
        const best = selectBestRoad(roadData.elements, { lat, lon });
        if (!best) continue;
        results.push({
          roadName: best.name,
          chain,
          tags: mergeWayTags(chain.tags.map((t, i) => ({ tags: t, id: chain.segmentIds[i] }))),
        });
      } catch {}
    }
    parallelLanes = groupByRoadAndProximity(results, 500);
    console.log(`  ${parallelLanes.length} parallel lane candidates`);
  }

  // Step 2c: Discover unnamed cycling chains (park paths, greenway corridors)
  console.log('Discovering unnamed cycling chains...');
  const MIN_CHAIN_LENGTH_M = 1500;
  const unchainedQ = `[out:json][timeout:120];
way["highway"~"cycleway|path"]["bicycle"~"designated|yes"][!"name"][!"crossing"](${b});
out geom tags;`;
  const unchainedData = await qo(unchainedQ);
  const unchainedWays = unchainedData.elements.filter(w => w.geometry?.length >= 2);

  const ucEpIndex = new Map();
  for (let i = 0; i < unchainedWays.length; i++) {
    const g = unchainedWays[i].geometry;
    for (const pt of [g[0], g[g.length - 1]]) {
      const key = pt.lat.toFixed(7) + ',' + pt.lon.toFixed(7);
      if (!ucEpIndex.has(key)) ucEpIndex.set(key, []);
      ucEpIndex.get(key).push(i);
    }
  }
  const ucParent = Array.from({ length: unchainedWays.length }, (_, i) => i);
  function ucFind(x) { while (ucParent[x] !== x) { ucParent[x] = ucParent[ucParent[x]]; x = ucParent[x]; } return x; }
  for (const [, indices] of ucEpIndex) {
    for (let i = 1; i < indices.length; i++) {
      const ra = ucFind(indices[0]), rb = ucFind(indices[i]);
      if (ra !== rb) ucParent[ra] = rb;
    }
  }

  const ucGroups = new Map();
  for (let i = 0; i < unchainedWays.length; i++) {
    const root = ucFind(i);
    if (!ucGroups.has(root)) ucGroups.set(root, []);
    ucGroups.get(root).push(i);
  }

  function wayLength(g) {
    let len = 0;
    for (let i = 1; i < g.length; i++) {
      const dlat = (g[i].lat - g[i - 1].lat) * 111320;
      const dlng = (g[i].lon - g[i - 1].lon) * 111320 * Math.cos(g[i].lat * Math.PI / 180);
      len += Math.sqrt(dlat * dlat + dlng * dlng);
    }
    return len;
  }

  const unnamedChains = [];
  for (const [, indices] of ucGroups) {
    let totalLen = 0;
    for (const i of indices) totalLen += wayLength(unchainedWays[i].geometry);
    if (totalLen < MIN_CHAIN_LENGTH_M) continue;

    // All naming queries use the chain's real geometry, never a midpoint.
    const chainWayIds = indices.map(i => unchainedWays[i].id).join(',');
    const chainPts = indices.flatMap(i => unchainedWays[i].geometry);

    // Name the chain from the closest named feature by real geometry.
    // Query parks (500m) and roads (100m) around the chain's actual ways,
    // then pick whichever is closest. A road 20m away beats a park 300m
    // away — the chain parallels the road, not the park.
    let chainName = null;

    // 1. Check containment first (is_in) — if the chain is INSIDE a park,
    //    that's the strongest signal. Sample multiple points along the chain.
    try {
      const samplePts = [];
      for (const i of indices) {
        const g = unchainedWays[i].geometry;
        samplePts.push(g[0], g[Math.floor(g.length / 2)], g[g.length - 1]);
      }
      for (const pt of samplePts) {
        if (chainName) break;
        try {
          const isInData = await qo(`[out:json][timeout:15];
is_in(${pt.lat},${pt.lon})->.a;
area.a["leisure"~"park|nature_reserve"]["name"]->.b;
area.a["landuse"~"recreation_ground"]["name"]->.c;
area.a["natural"="wood"]["name"]->.d;
(.b; .c; .d;);
out tags;`);
          if (isInData.elements.length > 0) {
            chainName = isInData.elements[0].tags?.name;
          }
        } catch {}
      }
    } catch {}

    // 2. If not inside a park, find the closest named feature — park or road.
    //    Both are queried using the chain's real geometry, and the closest
    //    by geometry-to-geometry distance wins.
    if (!chainName) {
      const candidates = [];
      try {
        const nearParkQ = `[out:json][timeout:15];
way(id:${chainWayIds})->.chain;
(way["leisure"="park"]["name"](around.chain:500);
relation["leisure"="park"]["name"](around.chain:500);
way["natural"="wood"]["name"](around.chain:500);
relation["natural"="wood"]["name"](around.chain:500););
out geom tags;`;
        const nearParkData = await qo(nearParkQ);
        candidates.push(...rankByGeomDistance(chainPts, nearParkData.elements));
      } catch {}
      try {
        const roadQ = `[out:json][timeout:15];
way(id:${chainWayIds})->.chain;
way["highway"~"^(primary|secondary|tertiary|residential)$"]["name"](around.chain:100);
out geom tags;`;
        const roadData = await qo(roadQ);
        candidates.push(...rankByGeomDistance(chainPts, roadData.elements));
      } catch {}
      candidates.sort((a, b) => a.dist - b.dist);
      if (candidates.length > 0) chainName = candidates[0].name;
    }

    if (!chainName) continue;

    const _ways = indices.map(i => unchainedWays[i].geometry);
    const anchors = [];
    for (const i of indices) {
      const g = unchainedWays[i].geometry;
      anchors.push([g[0].lon, g[0].lat]);
      anchors.push([g[g.length - 1].lon, g[g.length - 1].lat]);
    }
    const tags = mergeWayTags(indices.map(i => unchainedWays[i]));

    osmNamedWays.push({
      name: chainName,
      wayCount: indices.length,
      tags,
      anchors,
      osmNames: [chainName],
      _ways,
      _wayIds: indices.map(i => unchainedWays[i].id).filter(Boolean),
      _isUnnamedChain: true,
    });
    unnamedChains.push(chainName);
  }
  if (unnamedChains.length > 0) {
    console.log(`  Found ${unnamedChains.length} unnamed chains >= ${MIN_CHAIN_LENGTH_M / 1000}km`);
  }

  // Step 2d: Discover non-cycling route relations (hiking, skiing, etc.)
  // that share ways with our cycling infrastructure ("web spider").
  // Walk UP from cycling ways to find their parent non-cycling relations.
  // These are NOT entries — they become overlap metadata on existing entries.
  const nonCyclingCandidates = [];
  const allCyclingWayIds = [
    ...osmRelations.flatMap(r => r._memberWayIds || []),
    ...osmNamedWays.flatMap(np => np._wayIds || []),
  ].filter(Boolean);

  if (allCyclingWayIds.length > 0) {
    console.log('Discovering non-cycling relations sharing cycling infrastructure...');
    const CHUNK_SIZE = 2000;
    const allNonCyclingRels = new Map();
    for (let i = 0; i < allCyclingWayIds.length; i += CHUNK_SIZE) {
      const chunk = allCyclingWayIds.slice(i, i + CHUNK_SIZE);
      const spiderQ = `[out:json][timeout:120];\nway(id:${chunk.join(',')});\nrel(bw)["route"]["route"!="bicycle"]["route"!="mtb"]["route"!="bus"]["route"!="road"]["route"!="detour"]["route"!="ski"]["type"="route"];\nout tags;`;
      try {
        const spiderData = await qo(spiderQ);
        // Chunks are logged at debug level only
        for (const el of spiderData.elements) {
          if (!allNonCyclingRels.has(el.id)) allNonCyclingRels.set(el.id, el);
        }
      } catch (err) {
        console.error(`  Non-cycling relation discovery chunk failed: ${err.message}`);
      }
    }

    console.log(`  ${allNonCyclingRels.size} unique non-cycling relations found`);

    // rel(bw) returns relations without member lists. Fetch full body separately.
    if (allNonCyclingRels.size > 0) {
      const relIds = [...allNonCyclingRels.keys()];
      const bodyQ = `[out:json][timeout:120];\n(\n${relIds.map(id => `  relation(${id});`).join('\n')}\n);\nout body;`;
      try {
        const bodyData = await qo(bodyQ);
        for (const el of bodyData.elements) {
          if (el.members && allNonCyclingRels.has(el.id)) {
            allNonCyclingRels.get(el.id).members = el.members;
          }
        }
      } catch (err) {
        console.error(`  Failed to fetch non-cycling relation members: ${err.message}`);
      }
    }

    const cyclingWayIdSet = new Set(allCyclingWayIds);
    for (const [relId, el] of allNonCyclingRels) {
      const memberWayIds = (el.members || []).filter(m => m.type === 'way').map(m => m.ref);
      const bikeableWayIds = memberWayIds.filter(id => cyclingWayIdSet.has(id));
      if (bikeableWayIds.length === 0) continue;
      if (!el.tags?.name) continue; // skip unnamed relations — no display value
      const bikeablePct = bikeableWayIds.length / memberWayIds.length;
      nonCyclingCandidates.push({
        id: relId,
        name: el.tags.name,
        route: el.tags?.route || 'unknown',
        operator: el.tags?.operator,
        ref: el.tags?.ref,
        network: el.tags?.network,
        bikeableWayIds,
        bikeablePct,
      });
    }
    if (nonCyclingCandidates.length > 0) {
      console.log(`  Found ${nonCyclingCandidates.length} non-cycling relations sharing cycling ways`);
    }
  }

  // Step 3: Build entries from scratch
  console.log('Building entries from scratch...');
  const entries = buildEntries(osmRelations, osmNamedWays, parallelLanes, manualEntries, wayRegistry);

  // Enrich manual entries whose relations fell outside bbox
  const discoveredRelationIds = new Set(osmRelations.map(r => r.id));
  await enrichOutOfBoundsRelations(entries, discoveredRelationIds);

  // Enrich relation entries with _ways (transient geometry) for park
  // containment and entry-type classification. NOT anchors — anchors are
  // for Overpass name lookups only (see AGENTS.md). _ways is stripped
  // before YAML output.
  //
  // Fetch geometry for ALL entries with osm_relations, not just those
  // missing _ways. Name-based discovery (step 2) sometimes finds only a
  // tiny fragment (e.g. 33m for a 494km trail), and that fragment prevents
  // the relation geometry from loading. Use the relation geometry when it's
  // more complete than whatever name-based discovery found.
  const withRelations = entries.filter(e => e.osm_relations?.length > 0);
  if (withRelations.length > 0) {
    const relIds = [...new Set(withRelations.flatMap(e => e.osm_relations))];
    const q = `[out:json][timeout:120];\n(\n${relIds.map(id => `  relation(${id});`).join('\n')}\n);\nout geom;`;
    try {
      const data = await qo(q);
      const byId = new Map();
      for (const el of data.elements) {
        if (!byId.has(el.id) && el.members) {
          // Extract way geometries and way IDs for spatial operations
          const ways = [];
          const memberWayIds = [];
          for (const m of el.members) {
            if (m.type === 'way' && m.geometry?.length >= 2) {
              ways.push(m.geometry);
              if (m.ref) memberWayIds.push(m.ref);
            }
          }
          if (ways.length > 0) byId.set(el.id, { ways, wayIds: memberWayIds });
        }
      }
      let enriched = 0;
      for (const entry of withRelations) {
        for (const relId of entry.osm_relations) {
          const info = byId.get(relId);
          if (info) {
            // Use relation geometry if more complete than name-based discovery
            if (!entry._ways?.length || info.ways.length > entry._ways.length) {
              entry._ways = info.ways;
            }
            if (info.wayIds.length > 0) {
              wayRegistry.claim(entry, info.wayIds);
            }
            enriched++;
            break;
          }
        }
      }
      if (enriched > 0) console.log(`  Enriched ${enriched} relation entries with geometry`);
    } catch (err) {
      console.error(`  Relation geometry enrichment failed: ${err.message}`);
    }
  }

  // Step 3a-2: Merge unnamed relations into named ones in the same network.
  // Unnamed relations get synthetic names like "relation-18537256". When a
  // named relation with the same network tag exists and their ways connect
  // (shared endpoint within 200m), merge the unnamed into the named.
  {
    const CONNECT_M = 200;
    const unnamed = entries.filter(e => /^relation-\d+$/.test(e.name) && e.network && e._ways?.length);
    let mergedCount = 0;
    for (const entry of unnamed) {
      // Collect this entry's way endpoints
      const eps = [];
      for (const way of entry._ways) {
        if (way.length >= 2) {
          eps.push(way[0], way[way.length - 1]);
        }
      }
      if (eps.length === 0) continue;

      // Find named entries with same network tag that have connecting endpoints
      let bestTarget = null;
      let bestDist = Infinity;
      for (const candidate of entries) {
        if (candidate === entry) continue;
        if (candidate.network !== entry.network) continue;
        if (/^relation-\d+$/.test(candidate.name)) continue;
        if (!candidate._ways?.length) continue;
        // Check endpoint-to-endpoint distance
        for (const cWay of candidate._ways) {
          if (cWay.length < 2) continue;
          const cEps = [cWay[0], cWay[cWay.length - 1]];
          for (const ep of eps) {
            for (const cEp of cEps) {
              const d = haversineM([ep.lon, ep.lat], [cEp.lon, cEp.lat]);
              if (d < bestDist) { bestDist = d; bestTarget = candidate; }
            }
          }
        }
      }
      if (!bestTarget || bestDist > CONNECT_M) continue;

      // Merge: transfer relation IDs, geometry, way IDs
      bestTarget.osm_relations = [...(bestTarget.osm_relations || []), ...(entry.osm_relations || [])];
      bestTarget._ways = [...(bestTarget._ways || []), ...entry._ways];
      if (entry.anchors) bestTarget.anchors = [...(bestTarget.anchors || []), ...entry.anchors];
      const wayIds = wayRegistry.wayIdsFor(entry);
      if (wayIds.size > 0) wayRegistry.transfer(entry, bestTarget, wayIds);

      // Remove the unnamed entry
      const idx = entries.indexOf(entry);
      if (idx >= 0) entries.splice(idx, 1);
      mergedCount++;
      console.log(`  ~ merged ${entry.name} into ${bestTarget.name} (${Math.round(bestDist)}m endpoint distance)`);
    }
    if (mergedCount > 0) console.log(`  Merged ${mergedCount} unnamed relations into named entries`);
  }

  // Step 3b: Initial classification (tier-1 MTB + path_type)
  // Needed before clustering so cluster-entries can use path_type.
  const { mtbCount: tier1MtbCount } = classifyPathsEarly(entries);
  if (tier1MtbCount > 0) console.log(`  Tier-1 MTB: ${tier1MtbCount} entries`);

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
  // Clear previously derived long-distance type so classification rules
  // are re-evaluated from geometry (the pipeline may have written this
  // type in a previous run under different rules).
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
      promotedCount++;
    }
    if (promotedCount > 0) {
      console.log(`  Promoted ${promotedCount} non-cycling relations to entries (≥${Math.round(PROMOTE_THRESHOLD * 100)}% bikeable)`);
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

  const manualEntries = loadManualEntries();
  const markdownSlugs = loadMarkdownSlugs();
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
    // Persist way IDs from the registry before stripping transient fields
    for (const entry of entries) {
      const wayIds = wayRegistry.wayIdsFor(entry);
      if (wayIds.size > 0) {
        entry.osm_way_ids = [...wayIds].sort((a, b) => a - b);
      }
    }
    // Slugs already set by the resolution pass — strip transient fields
    for (const entry of entries) {
      delete entry._ways;
      delete entry._member_relations;
      if (entry._parkName) { entry.park = entry._parkName; }
      delete entry._parkName;
      delete entry._discovery_source;
      delete entry._isUnnamedChain;
    }
    for (const entry of entries) {
      if (entry.anchors?.length > 2) {
        const lngs = entry.anchors.map(a => a[0]);
        const lats = entry.anchors.map(a => a[1]);
        entry.anchors = [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]];
      }
    }
    // Final cleanup: strip member_of from large detached long-distance entries
    for (const entry of entries) {
      if (entry.type === 'long-distance' && entry.member_of && (entry.osm_way_ids?.length ?? 0) >= 200) {
        delete entry.member_of;
      }
    }
    const yamlData = { bike_paths: entries };
    if (superNetworks.length > 0) yamlData.super_networks = superNetworks;
    const output = yaml.dump(yamlData, { lineWidth: -1, noRefs: true });
    fs.writeFileSync(bikepathsPath, output);
    console.log(`\nWrote ${entries.length} entries (${networkEntries.length} networks, ${memberEntries.length} members) to ${bikepathsPath}`);
  }
}

if (isMain) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

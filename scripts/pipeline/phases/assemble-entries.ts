// scripts/pipeline/phases/assemble-entries.ts
//
// Phase 3a: assemble the unified entry list.
//
// Takes the 5-field DiscoveredData bundle + manual entries and produces
// the unified entry list. This is the largest single assembly step.
// Historical bug cluster: tag-bleeding regressions (Adàwe) live here.
//
// Steps (ported verbatim from lib/assemble.ts):
//   1. buildEntries              — merge manual + relations + named ways + parallel lanes,
//                                  claim ways in WayRegistry, enrich with relation tags
//   2. enrichOutOfBoundsRelations — fetch tags for manually added relations the bbox missed
//   3. enrichRelationGeometry    — fetch `out geom` for relations, populate _ways
//   4. mergeUnnamedRelations     — merge synthetic-named relations into named ones in
//                                  the same network
//   5. classifyPathsEarly         — tier-1 MTB + path_type derivation
//
// Trace events (sparse, at decision points only):
//   - entry:<slug> built      — after buildEntries, one per emitted entry
//   - entry:<name> merged     — when mergeUnnamedRelations merges into a target
//   - entry:<slug> classified — after classifyPathsEarly, one per entry with path_type

import type {
  DiscoveredData,
  NamedWayEntry,
  OsmRelation,
  ParallelLaneCandidate,
  QueryOverpass,
} from '../lib/pipeline-types.ts';
import type { WayRegistry } from '../lib/way-registry.mjs';
import type { Phase } from './_phase-types.ts';
import { extractOsmMetadata, enrichEntry } from '../lib/osm-tags.ts';
import { haversineM } from '../lib/geo.mjs';
import { slugifyBikePathName as slugify } from '../../../src/lib/bike-paths/bikepaths-yml.server.ts';
import { classifyPathsEarly } from '../../../src/lib/bike-paths/classify-path.ts';

// ---------------------------------------------------------------------------
// buildEntries — merge all discovery results into entries
// ---------------------------------------------------------------------------

/**
 * Build entries from discovered OSM data and manual entries.
 * No reference to any existing bikepaths.yml -- built from scratch.
 */
function buildEntries(
  osmRelations: OsmRelation[],
  osmNamedWays: NamedWayEntry[],
  parallelLanes: ParallelLaneCandidate[],
  manualEntries: any[],
  wayRegistry: WayRegistry,
) {
  console.log('Building entries from scratch...');

  const bySlug = new Map();
  const byRelation = new Map();
  const byName = new Map();
  const result: any[] = [];

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
  // lit) -- those live on member ways. enrichEntry() only sets missing fields,
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
    if (rel._memberWayIds && rel._memberWayIds.length > 0) {
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
        let bestEntry: any = null, bestCount = 0;
        for (const [entry, sharedIds] of overlap) {
          if (sharedIds.size > bestCount) { bestEntry = entry; bestCount = sharedIds.size; }
        }
        const overlapRatio = bestCount / npWayIds.length;
        if (overlapRatio >= 0.4 && bestEntry) {
          enrichEntry(bestEntry, np.tags, { skipIdentity: !!bestEntry.osm_relations?.length });
          if (np.anchors?.length > (bestEntry.anchors?.length || 0)) bestEntry.anchors = np.anchors;
          if (np._ways) bestEntry._ways = np._ways;
          const unclaimed = npWayIds.filter((id: number) => !wayRegistry.isClaimed(id));
          if (unclaimed.length > 0) wayRegistry.claim(bestEntry, unclaimed);
          continue;
        }
      }
    }

    const slug = slugify(np.name);
    const existing = bySlug.get(slug) || byName.get(np.name.toLowerCase());
    if (existing) {
      // Don't merge entries that are far apart -- they're different trails
      // with the same slug. E.g., "Trail 24" (Greenbelt, 45.30 N) and
      // "Trail #24" (Gatineau Park, 45.52 N) both slug to trail-24.
      // EXCEPTION: always merge into a relation entry with the same name.
      // Relations are authoritative -- a trail with a gap in the middle
      // (Voie Verte Chelsea) should still be one entry.
      const hasRelation = existing.osm_relations?.length > 0;
      const tooFar = !hasRelation &&
        existing.anchors?.length > 0 && np.anchors?.length > 0 &&
        haversineM(existing.anchors[0], np.anchors[0]) > 5000;
      if (tooFar) {
        // Different trail, same slug -- create separate entry (slug will be disambiguated later)
        const meta = extractOsmMetadata(np.tags);
        const entry: any = { name: np.name, osm_names: np.osmNames, anchors: np.anchors, _ways: np._ways, ...meta };
        entry._discovery_source = np._isUnnamedChain ? 'unnamed-chain' : 'named-way';
        result.push(entry);
        if (npWayIds.length > 0) wayRegistry.claim(entry, npWayIds);
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
    const entry: any = {
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
      // Even when merging into an existing entry, register the way IDs so
      // ghost-removal sees the full overlap for both entries.
      if (candidate._wayIds && candidate._wayIds.length > 0) {
        wayRegistry.claim(existingEntry, candidate._wayIds);
      }
      continue;
    }

    const entry: any = {
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
    // Register the way IDs so structural ghost-removal in finalize-resolve
    // can see that scott-street-style parallel entries overlap with a
    // relation entry and drop them.
    if (candidate._wayIds && candidate._wayIds.length > 0) {
      wayRegistry.claim(entry, candidate._wayIds);
    }
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
// enrichOutOfBoundsRelations
// ---------------------------------------------------------------------------

/**
 * Enrich manually added entries whose osm_relations were not found by the
 * bbox-scoped discovery query. Fetches tags directly by relation ID.
 * This is what makes manual one-offs work: add a relation ID to the file,
 * and the next script run fills in name, surface, network, etc. from OSM.
 */
async function enrichOutOfBoundsRelations(
  entries: any[],
  discoveredRelationIds: Set<number>,
  queryOverpass: QueryOverpass,
) {
  const missing: Array<{ relId: number; entry: any }> = [];
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
    const byId = new Map(data.elements.map((el: any) => [el.id, el.tags || {}]));
    for (const { relId, entry } of missing) {
      const tags = byId.get(relId);
      if (tags) {
        enrichEntry(entry, tags);
        console.log(`  Enriched: ${entry.name} (relation ${relId})`);
      }
    }
  } catch (err: any) {
    console.error(`  Failed to enrich out-of-bounds relations: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// enrichRelationGeometry
// ---------------------------------------------------------------------------

/**
 * Enrich relation entries with _ways (transient geometry) for park
 * containment and entry-type classification. NOT anchors -- anchors are
 * for Overpass name lookups only (see AGENTS.md). _ways is stripped
 * before YAML output.
 *
 * Fetch geometry for ALL entries with osm_relations, not just those
 * missing _ways. Name-based discovery (step 2) sometimes finds only a
 * tiny fragment (e.g. 33m for a 494km trail), and that fragment prevents
 * the relation geometry from loading. Use the relation geometry when it's
 * more complete than whatever name-based discovery found.
 */
async function enrichRelationGeometry(
  entries: any[],
  wayRegistry: WayRegistry,
  queryOverpass: QueryOverpass,
) {
  const withRelations = entries.filter((e: any) => e.osm_relations?.length > 0);
  if (withRelations.length === 0) return;

  const relIds = [...new Set(withRelations.flatMap((e: any) => e.osm_relations))];
  const q = `[out:json][timeout:120];\n(\n${relIds.map((id: number) => `  relation(${id});`).join('\n')}\n);\nout geom;`;
  try {
    const data = await queryOverpass(q);
    const byId = new Map();
    for (const el of data.elements) {
      if (!byId.has(el.id) && el.members) {
        // Extract way geometries and way IDs for spatial operations
        const ways: any[] = [];
        const memberWayIds: number[] = [];
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
  } catch (err: any) {
    console.error(`  Relation geometry enrichment failed: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// mergeUnnamedRelations
// ---------------------------------------------------------------------------

/**
 * Merge unnamed relations into named ones in the same network.
 * Unnamed relations get synthetic names like "relation-18537256". When a
 * named relation with the same network tag exists and their ways connect
 * (shared endpoint within 200m), merge the unnamed into the named.
 */
function mergeUnnamedRelations(
  entries: any[],
  wayRegistry: WayRegistry,
  trace: (subjectId: string, kind: string, data?: object) => void,
) {
  const CONNECT_M = 200;
  const unnamed = entries.filter((e: any) => /^relation-\d+$/.test(e.name) && e.network && e._ways?.length);
  let mergedCount = 0;
  for (const entry of unnamed) {
    // Collect this entry's way endpoints
    const eps: Array<{ lon: number; lat: number }> = [];
    for (const way of entry._ways) {
      if (way.length >= 2) {
        eps.push(way[0], way[way.length - 1]);
      }
    }
    if (eps.length === 0) continue;

    // Find named entries with same network tag that have connecting endpoints
    let bestTarget: any = null;
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
    trace(`entry:${entry.name}`, 'merged', { intoEntry: bestTarget.name, endpointDistanceM: Math.round(bestDist) });
    console.log(`  ~ merged ${entry.name} into ${bestTarget.name} (${Math.round(bestDist)}m endpoint distance)`);
  }
  if (mergedCount > 0) console.log(`  Merged ${mergedCount} unnamed relations into named entries`);
}

// ---------------------------------------------------------------------------
// assembleEntriesPhase — public phase entry point
// ---------------------------------------------------------------------------

interface Inputs {
  discovered: DiscoveredData;
  manualEntries: any[];
  wayRegistry: WayRegistry;
}

export const assembleEntriesPhase: Phase<Inputs, any[]> = async ({
  discovered,
  manualEntries,
  wayRegistry,
  ctx,
}) => {
  const { osmRelations, osmNamedWays, parallelLanes } = discovered;

  const entries = buildEntries(osmRelations, osmNamedWays, parallelLanes, manualEntries, wayRegistry);

  // Trace: one `built` event per emitted entry (sparse, decision-point only).
  for (const e of entries) {
    ctx.trace(`entry:${slugify(e.name)}`, 'built', {
      source: e._discovery_source,
      name: e.name,
    });
  }

  const discoveredRelationIds = new Set(osmRelations.map((r) => r.id));
  await enrichOutOfBoundsRelations(entries, discoveredRelationIds, ctx.queryOverpass);

  await enrichRelationGeometry(entries, wayRegistry, ctx.queryOverpass);

  mergeUnnamedRelations(entries, wayRegistry, ctx.trace);

  // Step 3b: Initial classification (tier-1 MTB + path_type)
  const { mtbCount: tier1MtbCount } = classifyPathsEarly(entries);
  if (tier1MtbCount > 0) console.log(`  Tier-1 MTB: ${tier1MtbCount} entries`);

  // Trace: one `classified` event per entry that got a path_type.
  for (const e of entries) {
    if (e.path_type) {
      ctx.trace(`entry:${slugify(e.name)}`, 'classified', {
        path_type: e.path_type,
        mtb: !!e.mtb,
      });
    }
  }

  return entries;
};

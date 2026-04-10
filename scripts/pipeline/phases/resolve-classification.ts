// scripts/pipeline/phases/resolve-classification.ts
//
// Phase 9 (★ star bug cluster): late classification.
//
// Steps 6-8d from the legacy resolve():
//   6.  Wikidata enrichment
//   7.  classifyPathsLate (tier-2/3 MTB inference)
//   7c. deriveEntryType for each entry
//   8d. Non-cycling relation promotion (≥90% bikeable) and overlap metadata
//
// Operates on the entries array in place (matches legacy resolve()
// semantics) and returns it. Most fixes in pipeline history live in these
// four steps — this is the second-largest bug cluster boundary after
// assemble.entries.
//
// Trace events (sparse, at decision points only):
//   - entry:<name> classified — after deriveEntryType sets a type
//   - entry:<name> promoted   — when a non-cycling candidate is promoted

import type { DiscoveredData } from '../lib/pipeline-types.ts';
import type { Phase } from './_phase-types.ts';
import type { WayRegistry } from '../lib/way-registry.mjs';
import { enrichWithWikidata } from '../lib/wikidata.mjs';
import { classifyPathsLate } from '../../../src/lib/bike-paths/classify-path.ts';
import { deriveEntryType } from '../lib/entry-type.mjs';

const PROMOTE_THRESHOLD = 0.9;

interface Inputs {
  entries: any[];
  discovered: DiscoveredData;
  wayRegistry: WayRegistry;
}

export const resolveClassificationPhase: Phase<Inputs, any[]> = async ({
  entries,
  discovered,
  wayRegistry,
  ctx,
}) => {
  const grouped = entries; // mutate-in-place pattern from the original resolve()

  // Step 6: Wikidata enrichment
  console.log('Enriching with Wikidata...');
  const wdCount = await enrichWithWikidata(grouped);
  if (wdCount > 0) console.log(`  Enriched ${wdCount} entries`);

  // Step 7: Complete classification (tier-2/3 MTB + path_type update).
  // Networks now exist from clustering. Tier-2 inherits MTB across networks.
  // Tier-3 labels ambient dirt trails. path_type updated for affected entries.
  const { mtbCount } = classifyPathsLate(grouped);
  if (mtbCount > 0) console.log(`  Labelled ${mtbCount} entries as MTB (tier 2+3)`);

  // Step 7c: Derive entry type (destination/infrastructure/connector).
  // Depends on path_type and _ways (still available, stripped later).
  // Networks already have type: 'network' — deriveEntryType skips them.
  for (const entry of grouped) {
    if (entry.type === 'long-distance') delete entry.type;
    const et = deriveEntryType(entry);
    if (et) {
      entry.type = et;
      ctx.trace(`entry:${entry.name}`, 'classified', { type: et });
    }
  }

  // Step 8d: Process non-cycling relation candidates (before slug computation).
  // 90%+ bikeable -> the ways tell us this IS cycling infrastructure. Promote
  // to a real entry -- the relation's route tag (hiking, piste) is a fact,
  // not its identity. Below 90% -> attach as overlap metadata on existing
  // entries.
  const { nonCyclingCandidates } = discovered;
  if (nonCyclingCandidates.length > 0) {
    const promoted: any[] = [];
    const overlapOnly: any[] = [];
    for (const c of nonCyclingCandidates) {
      if (c.bikeablePct >= PROMOTE_THRESHOLD) promoted.push(c);
      else overlapOnly.push(c);
    }

    // Promote high-bikeable relations to real entries
    let promotedCount = 0;
    for (const candidate of promoted) {
      const existingEntry = grouped.find((e: any) => e.osm_relations?.includes(candidate.id));
      if (existingEntry) continue;

      const entry: any = {
        name: candidate.name,
        osm_relations: [candidate.id],
        osm_way_ids: candidate.bikeableWayIds.sort((a: number, b: number) => a - b),
        route_type: candidate.route,
      };
      if (candidate.operator) entry.operator = candidate.operator;
      if (candidate.ref) entry.ref = candidate.ref;
      if (candidate.network) entry.network = candidate.network;
      grouped.push(entry);
      wayRegistry.claim(entry, candidate.bikeableWayIds);
      promotedCount++;
      ctx.trace(`entry:${entry.name}`, 'promoted', {
        from: 'non-cycling-relation',
        bikeablePct: candidate.bikeablePct,
        route: candidate.route,
      });
    }
    if (promotedCount > 0) {
      console.log(
        `  Promoted ${promotedCount} non-cycling relations to entries (>=${Math.round(PROMOTE_THRESHOLD * 100)}% bikeable)`,
      );
    }

    // Classify promoted entries -- they were added after steps 3b/7/7c.
    // Derive path_type from the cycling entries that own their ways,
    // then derive entry type normally.
    for (const entry of grouped) {
      if (!entry.path_type && entry.route_type) {
        const ptCounts: Record<string, number> = {};
        for (const wid of (entry.osm_way_ids || [])) {
          const owner = wayRegistry.ownerOf(wid) as any;
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
        for (const [entry, ways] of (wayRegistry as any)._entryToWays) {
          if (ways.has(wayId)) entrySet.add(entry);
        }
      }
      for (const entry of entrySet as Set<any>) {
        if (!entry.overlapping_relations) entry.overlapping_relations = [];
        if (!entry.overlapping_relations.some((r: any) => r.id === candidate.id)) {
          entry.overlapping_relations.push({
            id: candidate.id,
            name: candidate.name,
            route: candidate.route,
            operator: candidate.operator,
            ref: candidate.ref,
            network: candidate.network,
            wikipedia: candidate.wikipedia,
            website: candidate.website,
          });
        }
      }
    }
    const overlapped = grouped.filter((e: any) => e.overlapping_relations?.length > 0).length;
    if (overlapped > 0) {
      console.log(
        `  Attached overlap metadata to ${overlapped} entries (below ${Math.round(PROMOTE_THRESHOLD * 100)}%)`,
      );
    }
  }

  return grouped;
};

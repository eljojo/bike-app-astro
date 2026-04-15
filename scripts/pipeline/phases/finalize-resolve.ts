// scripts/pipeline/phases/finalize-resolve.ts
//
// Phase 11: finalize entries — slug resolution, ghost removal, validation.
//
// Steps from legacy resolve():
//   9.   Detach long-distance entries >= DETACH_WAY_THRESHOLD ways from networks.
//        Compute slugs once via computeSlugs(). Resolve _networkRef,
//        _superNetworkRef, and _memberRefs to slug strings (with memberSort
//        from the adapter). Resolve superNetworks metadata _entryRef.
//   9b.  Remove ghost entries (non-relation entries whose ways are mostly
//        owned by relation entries — structural + name-based fallback).
//        Clean up references to dropped slugs in network.members arrays.
//   9c.  Validate — warn if any OSM relation appears in two entries.
//   ...  Attach osm_way_ids from the registry.
//
// Pure business logic — no file I/O. The companion finalize-write.ts
// handles the YAML output.

import type { Phase } from './_phase-types.ts';
import type { WayRegistry } from '../lib/way-registry.mjs';
import { computeSlugs } from '../lib/auto-group.ts';

interface Inputs {
  entries: any[];
  superNetworks: any[];
  wayRegistry: WayRegistry;
  relationBaseNames: Set<string>;
}

interface Output {
  entries: any[];
  slugMap: Map<any, string>;
  superNetworks: any[];
}

const DETACH_WAY_THRESHOLD = 200;

export const finalizeResolvePhase: Phase<Inputs, Output> = async ({
  entries,
  superNetworks,
  wayRegistry,
  relationBaseNames,
  ctx,
}) => {
  const grouped = [...entries];

  // Step 9: Detach long-distance entries that extend far beyond their network.
  // Short local segments of national trails (TCT Bells Corners, TCT Sussex)
  // stay as members — the pipeline assigned them based on real way overlap.
  // Only truly large trails (>=200 ways) get detached.
  const detachedEntries = new Set<any>();
  for (const entry of grouped) {
    if (entry.type === 'long-distance' && entry._networkRef) {
      const wayCount = entry._ways?.length ?? 0;
      if (wayCount >= DETACH_WAY_THRESHOLD) {
        const net = entry._networkRef;
        if (net._memberRefs) {
          net._memberRefs = net._memberRefs.filter((m: any) => m !== entry);
        }
        delete entry._networkRef;
        detachedEntries.add(entry);
      }
    }
  }

  // Compute slugs once and resolve every _ref field to a slug string.
  const slugMap = computeSlugs(grouped);

  // Order network members by the city adapter's comparator (falls back to a
  // natural-name sort). This is the last write to `members`, so downstream
  // consumers (Astro render, tests, tiles) see a stable, sorted order.
  const memberSort = ctx.adapter.memberSort;
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
      if (memberSort) entry._memberRefs.sort(memberSort);
      entry.members = entry._memberRefs
        .map((ref: any) => slugMap.get(ref))
        .filter(Boolean);
      delete entry._memberRefs;
    }
    entry.slug = slugMap.get(entry);
    ctx.trace(`entry:${entry.name}`, 'slugged', { slug: entry.slug });
  }

  // Strip member_of from detached long-distance entries (after resolution).
  for (const entry of detachedEntries) {
    delete entry.member_of;
  }

  // Resolve superNetworks metadata slugs from the final slugMap.
  for (const meta of superNetworks) {
    if (meta._entryRef) {
      meta.slug = slugMap.get(meta._entryRef);
      delete meta._entryRef;
    }
  }

  // Step 9b: Remove ghost entries — non-relation entries whose ways are
  // mostly claimed by a relation entry. Two strategies:
  //   1. Structural (preferred): if >=50% of an entry's ways are also
  //      claimed by another entry that has osm_relations, it's a ghost.
  //   2. Name-based fallback: for entries with no way IDs (parallel lanes,
  //      manual entries), fall back to the relationBaseNames check.
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
        // Strategy 1: structural — check way overlap with relation entries.
        // Use claimersOf so the check doesn't depend on which entry claimed
        // the way first; we want every claimer of the way, not just the
        // first one the registry remembered.
        let ownedByOthers = 0;
        for (const wid of wayIds) {
          const claimers = wayRegistry.claimersOf(wid);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          if (claimers.some((c: any) => c !== e && c.osm_relations?.length > 0)) {
            ownedByOthers++;
          }
        }
        if (ownedByOthers / wayIds.size < 0.5) continue; // keep — not a ghost
        structuralCount++;
      } else {
        // Strategy 2: name-based fallback for entries without way IDs.
        if (!relationBaseNames || relationBaseNames.size === 0) continue;
        const baseName = e.name?.toLowerCase();
        if (!baseName || !relationBaseNames.has(baseName)) continue;
        nameCount++;
      }

      // Remove the ghost entry.
      const slug = e.slug;
      ctx.trace(`entry:${e.name}`, 'dropped', { reason: 'ghost', slug });
      wayRegistry.remove(e);
      grouped.splice(i, 1);
      // Clean up network member references.
      for (const net of grouped) {
        if (net.members && slug) {
          const idx = net.members.indexOf(slug);
          if (idx !== -1) net.members.splice(idx, 1);
        }
      }
    }
    if (grouped.length < before) {
      const parts: string[] = [];
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
    const relToEntry = new Map<number, any>();
    const conflicts: { relId: number; entries: any[] }[] = [];
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
      console.warn(`  \u26A0 ${conflicts.length} relation(s) appear in multiple entries:`);
      for (const { relId, entries: owners } of conflicts.slice(0, 10)) {
        const names = owners.map((e: any) => e.name || e.slug || '?').join(', ');
        console.warn(`    relation ${relId}: ${names}`);
      }
      if (conflicts.length > 10) console.warn(`    ... and ${conflicts.length - 10} more`);
    }
  }

  // Attach osm_way_ids from the registry (for tests and downstream callers).
  for (const entry of grouped) {
    const wayIds = wayRegistry.wayIdsFor(entry);
    if (wayIds.size > 0) {
      entry.osm_way_ids = [...wayIds].sort((a: number, b: number) => a - b);
    }
  }

  // Trace each surviving entry as resolved.
  for (const e of grouped) {
    ctx.trace(`entry:${e.name}`, 'resolved');
  }

  return { entries: grouped, slugMap, superNetworks };
};

// scripts/pipeline/phases/decompose-long-distance.ts
//
// Stage 2 long-distance decomposition: turn monolithic long-distance
// entries (Sentier Trans-Canada Gatineau-Montréal, Route Verte 1) into
// networks with regional sub-paths.
//
// Operates on entries whose type=long-distance AND osm_way_ids.length
// meets DECOMPOSE_WAYS_THRESHOLD. For each, reads the way-level OSM
// name data from the geometry cache (.cache/bikepath-geometry/{city}/)
// and clusters ways by name. Clusters above SUBPATH_MIN_WAYS become
// sub-path entries; the parent becomes type=network with them as
// members.
//
// Cache dependency: first pipeline run has no cache for new entries —
// the phase is a no-op for those. After cache-path-geometry.ts runs
// (usually invoked by a parent make target), subsequent pipeline runs
// see the cache and decompose. This self-heals: run pipeline → run
// cache → run pipeline again.

import fs from 'node:fs';
import path from 'node:path';
import type { Phase } from './_phase-types.ts';
import { slugifyBikePathName as slugify } from '../../../src/lib/bike-paths/bikepaths-yml.server.ts';

/** Entries with fewer ways than this are left alone. Ottawa's TCT-Québec
 *  has 700 ways; Route Verte 1 has 3201; Algonquin Trail has 69 (stays
 *  whole). Le P'tit Train du Nord (61) and Cycloparc PPJ (41) also stay
 *  whole — they're already regional-scale. */
export const DECOMPOSE_WAYS_THRESHOLD = 150;

/** Minimum ways in a name-cluster to emit it as its own sub-path. Under
 *  this the cluster stays as part of the parent's residual geometry. */
export const SUBPATH_MIN_WAYS = 15;

interface Inputs {
  entries: any[];
  cacheDir?: string;
}

interface CacheFeature {
  properties?: { name?: string; wayId?: number };
}
interface CacheData {
  features?: CacheFeature[];
}

function loadCachedNames(cacheDir: string, relationId: number): Array<{ name: string; wayId: number }> {
  const file = path.join(cacheDir, `${relationId}.geojson`);
  if (!fs.existsSync(file)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf-8')) as CacheData;
    const out: Array<{ name: string; wayId: number }> = [];
    for (const f of data.features ?? []) {
      const name = (f.properties?.name ?? '').trim();
      const wayId = f.properties?.wayId;
      if (typeof wayId === 'number') out.push({ name, wayId });
    }
    return out;
  } catch {
    return [];
  }
}

/** Group ways by exact name (empty-name cluster collapses to residual). */
function clusterByName(ways: Array<{ name: string; wayId: number }>): Map<string, number[]> {
  const buckets = new Map<string, number[]>();
  for (const w of ways) {
    let bucket = buckets.get(w.name);
    if (!bucket) { bucket = []; buckets.set(w.name, bucket); }
    bucket.push(w.wayId);
  }
  return buckets;
}

export const decomposeLongDistancePhase: Phase<Inputs, any[]> = async ({ entries, cacheDir, ctx }) => {
  if (!cacheDir || !fs.existsSync(cacheDir)) return entries;

  const grouped = [...entries];
  const slugsInUse = new Set<string>();
  for (const e of grouped) {
    const s = slugify(e.name ?? '');
    if (s) slugsInUse.add(s);
  }

  const toAdd: any[] = [];
  let decomposed = 0;

  for (const entry of grouped) {
    if (entry.type !== 'long-distance') continue;
    const wayIds = entry.osm_way_ids ?? [];
    if (wayIds.length < DECOMPOSE_WAYS_THRESHOLD) continue;

    const relId = entry.osm_relations?.[0];
    if (!relId) continue;

    const namedWays = loadCachedNames(cacheDir, relId);
    if (namedWays.length === 0) continue;

    const clusters = clusterByName(namedWays);
    const subpathsCreated: any[] = [];
    const transferredWayIds = new Set<number>();

    for (const [name, wids] of clusters) {
      if (!name || wids.length < SUBPATH_MIN_WAYS) continue;
      const baseSlug = slugify(name);
      if (!baseSlug) continue;
      // Derive a unique sub-path slug under the parent's namespace so
      // "Chemin Saint-Charles" inside TCT-QC doesn't collide with other
      // cities' paths of the same name.
      let subSlug = `${entry.slug ?? slugify(entry.name ?? '')}-${baseSlug}`;
      let i = 1;
      while (slugsInUse.has(subSlug)) {
        subSlug = `${entry.slug ?? slugify(entry.name ?? '')}-${baseSlug}-${++i}`;
      }
      slugsInUse.add(subSlug);

      const subEntry: any = {
        name,
        slug: subSlug,
        type: 'destination',
        path_type: entry.path_type,
        surface: entry.surface,
        member_of: entry.slug,
        osm_way_ids: wids.slice().sort((a, b) => a - b),
        _decomposed_from: entry.slug,
      };
      toAdd.push(subEntry);
      subpathsCreated.push(subEntry);
      for (const w of wids) transferredWayIds.add(w);
    }

    if (subpathsCreated.length === 0) continue;

    // Parent stays type=long-distance (per _ctx/entry-types.md, long-
    // distance entries have optional members). Classifier sends it to
    // the Long Distance tab by type, not by member path_type modality.
    // Keep residual ways (unnamed + small-cluster) for parent geometry.
    entry.members = subpathsCreated.map((s) => s.slug);
    entry.osm_way_ids = wayIds.filter((w: number) => !transferredWayIds.has(w));

    ctx.trace(`entry:${entry.name}`, 'decomposed', {
      kind: 'long-distance',
      subpathCount: subpathsCreated.length,
      waysTransferred: transferredWayIds.size,
      waysResidual: entry.osm_way_ids.length,
    });
    decomposed++;
  }

  if (decomposed > 0) {
    console.log(`Decomposed ${decomposed} long-distance monolith(s) into ${toAdd.length} sub-paths`);
  }

  return [...grouped, ...toAdd];
};

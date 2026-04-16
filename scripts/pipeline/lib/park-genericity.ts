// scripts/pipeline/lib/park-genericity.ts
//
// Rule 4 (Stage 2): measure whether a park is "too generic" to serve as
// the identity for an unnamed cycling chain that happens to be inside
// it. A park with many bike paths can't usefully identify any one of
// them — a chain named "Parc de la Gatineau" when 50 other paths also
// lie inside doesn't tell a rider where to go.
//
// Signal: count the distinct cycling identities inside the park polygon.
// "Identity" = distinct OSM `name` tag on a cycling way, plus one for
// each unnamed way (approximation for unnamed connector paths that
// would each compete for the park's name). Park is generic if the
// count meets PARK_GENERIC_MIN_PATHS or higher.
//
// Implementation: one Overpass query for cycling ways in the city bbox
// + reuse of `fetchParkPolygons` for park polygons. Local point-in-
// polygon via pointInPolygon to count paths per park. Lazy-cached by
// bbox string for the life of the pipeline run.
//
// See 2026-04-16-bike-paths-ia-mega.md Rule 4 and the 1000-word chat
// explanation from 2026-04-16.

import { fetchParkPolygons, pointInPolygon } from './park-containment.mjs';

/** Count threshold. A park with this many or more cycling identities
 *  inside its polygon is "too generic" — the pipeline should not borrow
 *  its name for an unnamed chain. Start with 2 (park is generic if
 *  2+ distinct cycling identities exist inside). */
export const PARK_GENERIC_MIN_PATHS = 2;

export interface ParkGenericityEntry {
  name: string;
  distinctNames: number;
  unnamedWays: number;
  total: number;
  tooGeneric: boolean;
}

/** Lazy-cached index keyed by bbox string. Each pipeline run uses one
 *  bbox and reuses the index across many chain-naming decisions. */
const indexCache = new Map<string, Promise<Map<string, ParkGenericityEntry>>>();

export function clearParkGenericityCache(): void {
  indexCache.clear();
}

export async function getParkGenericityIndex(
  bbox: string,
  queryOverpass: (q: string) => Promise<{ elements: unknown[] }>,
): Promise<Map<string, ParkGenericityEntry>> {
  let p = indexCache.get(bbox);
  if (!p) {
    p = buildIndex(bbox, queryOverpass);
    indexCache.set(bbox, p);
  }
  return p;
}

async function buildIndex(
  bbox: string,
  queryOverpass: (q: string) => Promise<{ elements: unknown[] }>,
): Promise<Map<string, ParkGenericityEntry>> {
  // Fetch park polygons (reuses pipeline infra). Includes nature_reserve,
  // park, protected_area, forest — same set as classify-by-park.
  const parks = await fetchParkPolygons(bbox, queryOverpass);

  // Fetch cycling ways in the bbox. `bicycle!~no` excludes paths that
  // explicitly forbid bikes. Unnamed ways are kept (they're the
  // collision source Rule 4 addresses).
  const waysQ = `[out:json][timeout:60];way["highway"~"cycleway|path"]["bicycle"!~"no"](${bbox});out geom tags;`;
  const waysData = await queryOverpass(waysQ);
  const cyclingWays = (waysData.elements as Array<{
    id?: number;
    geometry?: Array<{ lat: number; lon: number }>;
    tags?: { name?: string };
  }>).filter((w) => w.geometry && w.geometry.length > 0);

  const index = new Map<string, ParkGenericityEntry>();
  for (const park of parks as Array<{ name: string; polygon: Array<{ lat: number; lon: number }> }>) {
    const names = new Set<string>();
    let unnamed = 0;
    for (const way of cyclingWays) {
      // Sample the first, middle, and last point — if any is inside the
      // polygon, count the way as "in the park." Cheap vs checking every
      // vertex and good enough for cycling-way granularity.
      const g = way.geometry!;
      const samples = [g[0], g[Math.floor(g.length / 2)], g[g.length - 1]];
      const inside = samples.some((pt) => pointInPolygon(pt, park.polygon));
      if (!inside) continue;
      const tagName = way.tags?.name;
      if (tagName) names.add(tagName);
      else unnamed++;
    }
    // "Cycling identity" count: each distinct OSM name is one identity.
    // All unnamed ways collapse into ONE identity (rough approximation of
    // "one unnamed chain"). OSM splits a single trail into many ways;
    // counting unnamed ways individually inflates the metric. This
    // approximation over-counts when a park has multiple disconnected
    // unnamed chains — accepted trade-off. The `-N` suffix fallback
    // handles that residual case.
    const identities = names.size + (unnamed > 0 ? 1 : 0);
    index.set(park.name, {
      name: park.name,
      distinctNames: names.size,
      unnamedWays: unnamed,
      total: identities,
      tooGeneric: identities >= PARK_GENERIC_MIN_PATHS,
    });
  }
  return index;
}

/** Convenience lookup. Returns false when the park isn't in the index
 *  (unknown park — don't reject; step-through-to-road fallback handles
 *  unknown parks naturally). */
export async function isParkTooGeneric(
  parkName: string,
  bbox: string,
  queryOverpass: (q: string) => Promise<{ elements: unknown[] }>,
): Promise<boolean> {
  const index = await getParkGenericityIndex(bbox, queryOverpass);
  const entry = index.get(parkName);
  return entry ? entry.tooGeneric : false;
}

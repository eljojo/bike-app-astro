// scripts/pipeline/phases/cluster-standalone-bikeways.ts
//
// Rule 8 (Stage 1.5): cluster standalone bike-lane-class paths into
// editorial bikeway networks by region. In Ottawa, this surfaces a
// `gatineau-bikeways` network from the Gatineau-side protected lanes that
// previously sat as loose standalones in the Bikeways tab. No OSM admin
// relation backs the grouping — it's a pipeline-synthesized network.
//
// Regions come from the caller (city adapter / config). Each region is a
// { name, slug, latMin, latMax, lngMin, lngMax } bounding box. A standalone
// whose anchor falls inside the bbox belongs to that region's cluster.
//
// Skips regions where an existing network with the target slug already
// exists — those came from OSM or auto-group and are authoritative.

import type { Phase } from './_phase-types.ts';
import { slugifyBikePathName as slugify } from '../../../src/lib/bike-paths/bikepaths-yml.server.ts';

export interface BikewayClusterRegion {
  /** Display name of the synthesized network, e.g. "Gatineau Bikeways". */
  name: string;
  /** Slug to use for the network entry. */
  slug: string;
  /** Bounding box — coordinates of the region. */
  latMin: number;
  latMax: number;
  lngMin: number;
  lngMax: number;
}

/** Path_type values that count as "bikeways" for Rule 8 clustering. */
const BIKEWAY_PATH_TYPES = new Set(['bike-lane', 'separated-lane', 'paved-shoulder']);

/** Major road highway values — entries on these roads don't belong in the
 *  editorial bikeway grouping even if they have painted bike infrastructure.
 *  Route 105 etc. are primary highways; cyclists looking for "Gatineau
 *  Bikeways" aren't looking for primary-road bike lanes. */
const MAJOR_ROAD_HIGHWAYS = new Set(['primary', 'secondary', 'tertiary', 'trunk', 'motorway']);

/** Minimum member count to justify emitting a cluster network. */
export const MIN_CLUSTER_MEMBERS = 3;

interface Inputs {
  entries: any[];
  regions: BikewayClusterRegion[];
}

function anchorOf(entry: any): { lng: number; lat: number } | null {
  const a = entry.anchors?.[0];
  if (!a) return null;
  // bikepaths.yml anchors are [lng, lat] tuples in OSM order.
  if (Array.isArray(a) && a.length >= 2) return { lng: a[0], lat: a[1] };
  if (typeof a === 'object' && 'lat' in a && 'lng' in a) return { lng: a.lng, lat: a.lat };
  return null;
}

function inRegion(anchor: { lng: number; lat: number }, region: BikewayClusterRegion): boolean {
  return anchor.lat >= region.latMin && anchor.lat <= region.latMax
      && anchor.lng >= region.lngMin && anchor.lng <= region.lngMax;
}

export const clusterStandaloneBikewaysPhase: Phase<Inputs, any[]> = async ({ entries, regions, ctx }) => {
  if (regions.length === 0) return entries;

  const grouped = [...entries];
  const existingSlugs = new Set<string>();
  for (const e of grouped) {
    if (e.type === 'network') existingSlugs.add(slugify(e.name ?? ''));
  }

  // Standalones eligible for clustering: any non-network entry with a
  // bikeway-class path_type, no existing network membership, and NOT on
  // a major road. Major-road entries (highway=primary/secondary/tertiary)
  // are excluded even when they carry painted bike lanes — cyclists don't
  // plan by "Route 105 bike lane"; they plan by protected corridors on
  // residential or cycleway-class roads.
  const candidates = grouped.filter((e: any) =>
    e.type !== 'network'
    && !e._networkRef
    && !e.member_of
    && BIKEWAY_PATH_TYPES.has(e.path_type)
    && !MAJOR_ROAD_HIGHWAYS.has(e.highway)
  );

  let added = 0;
  for (const region of regions) {
    if (existingSlugs.has(region.slug)) continue;

    const members = candidates.filter((c: any) => {
      const a = anchorOf(c);
      return a !== null && inRegion(a, region);
    });
    if (members.length < MIN_CLUSTER_MEMBERS) continue;

    const networkEntry: any = {
      name: region.name,
      type: 'network',
      _memberRefs: members,
      _source: 'bikeway-cluster',
    };
    for (const m of members) {
      if (!m._networkRef) m._networkRef = networkEntry;
    }
    grouped.push(networkEntry);
    ctx.trace(`entry:${networkEntry.name}`, 'created', {
      kind: 'bikeway-cluster',
      region: region.slug,
      memberCount: members.length,
    });
    added++;
  }

  if (added > 0) {
    console.log(`Added ${added} clustered bikeway network(s)`);
  }

  return grouped;
};

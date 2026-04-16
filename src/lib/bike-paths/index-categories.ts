/**
 * Category classification for the bike paths index page.
 *
 * Extracted verbatim from index.astro for testability.
 * Both index.astro and tests import from here — single source of truth.
 */

export type BrowseCategory = 'pathways' | 'bikeways' | 'local_trails' | 'long_distance_trails' | 'mtb';

export const TIER1_MIN_KM = 3;

/** MTB-member share at which a network is classified as MTB. */
export const MTB_NETWORK_THRESHOLD = 0.7;

const BIKEWAY_PATH_TYPES = new Set(['bike-lane', 'separated-lane', 'paved-shoulder']);
/** Minimum mup-member count at which a network is anchored in Pathways,
 *  regardless of bike-lane member share. MUP presence dominates — a network
 *  with ≥3 paved shared-use paths is a "pathway network" in user terms even
 *  if it also contains bike-lane members on adjacent roads. */
const PATHWAYS_ANCHOR_MUP_COUNT = 3;

/**
 * Classify a network page into a browse tab category.
 *
 * @param entryType  The network's pipeline entry type (e.g. 'network', 'long-distance')
 * @param network    OSM network tag (lcn/rcn/ncn) if any
 * @param memberPathTypes  Resolved path_type values of all members
 */
export function classifyNetwork(
  entryType: string,
  network: string | undefined,
  memberPathTypes: string[],
): BrowseCategory {
  if (entryType === 'long-distance') return 'long_distance_trails';

  if (memberPathTypes.length === 0) return 'pathways';

  const mtbCount = memberPathTypes.filter(pt => pt === 'mtb-trail').length;
  if (mtbCount / memberPathTypes.length >= MTB_NETWORK_THRESHOLD) return 'mtb';

  // Bikeways-first check: if no pathway members dominate, and bikeways
  // or lcn are the signal, the network lives in the Bikeways tab. The
  // MUP anchor below overrides this for pathway-dominated mixed networks
  // like NCC Greenbelt where bike-lane road entries are incidental.
  const mupCount = memberPathTypes.filter(pt => pt === 'mup').length;
  if (mupCount >= PATHWAYS_ANCHOR_MUP_COUNT) return 'pathways';

  const bikewayCount = memberPathTypes.filter(pt => BIKEWAY_PATH_TYPES.has(pt)).length;
  if (bikewayCount / memberPathTypes.length >= 0.5) return 'bikeways';

  if (network === 'lcn') return 'bikeways';
  return 'pathways';
}

/**
 * Classify a standalone path (not in any network) into a browse tab category.
 * Returns null for paths that go to the "all" tab (uncategorized).
 *
 * `type:long-distance` is authoritative — the pipeline already applies a
 * length threshold (≥50km OR megatrail ≥30km with relation) when assigning
 * that type. No second length check here; we trust pipeline output.
 */
export function classifyIndependentPath(
  entryType: string,
  pathType?: string,
): BrowseCategory | null {
  if (entryType === 'long-distance') return 'long_distance_trails';
  if (pathType === 'mtb-trail') return 'mtb';
  if (pathType === 'trail') return 'local_trails';
  if (pathType === 'bike-lane' || pathType === 'separated-lane' || pathType === 'paved-shoulder') return 'bikeways';
  if (pathType === 'mup') return 'pathways';
  return null;
}

/**
 * Split network members into tier1 (prominent) and tier2 (collapsed).
 */
export function splitMemberTiers<T extends { hasMarkdown: boolean; length_km?: number }>(
  members: T[],
  minKm: number = TIER1_MIN_KM,
): { tier1: T[]; tier2: T[] } {
  let tier1 = members.filter(m => m.hasMarkdown || (m.length_km != null && m.length_km >= minKm));
  let tier2 = members.filter(m => !m.hasMarkdown && (m.length_km == null || m.length_km < minKm));
  if (tier2.length > 0 && tier2.length <= 3) {
    tier1 = [...tier1, ...tier2];
    tier2 = [];
  }
  return { tier1, tier2 };
}

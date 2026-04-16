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

/** Is this OSM `cycle_network` value a municipal (city/town) cycle network,
 *  as opposed to a regional/national pathway system? Convention:
 *    `CA:ON:Ottawa`   — municipal bikeways (bikeways tab)
 *    `CA:QC:Gatineau` — municipal bikeways (bikeways tab)
 *    `CA:ON:NCC`      — NCC agency pathway system (pathways tab)
 *    `CA:ON:TCT`      — Trans-Canada Trail (long-distance, not this tab)
 *  Municipal values end with a Capitalized city name; agency codes are
 *  all-caps initials. */
function isMunicipalCycleNetwork(cycleNetwork: string): boolean {
  // Pattern: last segment after colon is capitalized + lowercase (not all caps).
  const parts = cycleNetwork.split(':');
  const last = parts[parts.length - 1];
  if (!last || last.length < 2) return false;
  // Must have at least one lowercase letter to count as a city name.
  return /[a-z]/.test(last) && /^[A-Z]/.test(last);
}
/** Minimum mup-member count at which a network is anchored in Pathways,
 *  regardless of bike-lane member share. MUP presence dominates — a network
 *  with ≥3 paved shared-use paths is a "pathway network" in user terms even
 *  if it also contains bike-lane members on adjacent roads. */
const PATHWAYS_ANCHOR_MUP_COUNT = 3;

/**
 * Classify a network page into a browse tab category.
 *
 * @param entryType     The network's pipeline entry type (e.g. 'network', 'long-distance')
 * @param network       OSM network tag (lcn/rcn/ncn) if any
 * @param memberPathTypes  Resolved path_type values of all members
 * @param cycleNetwork  OSM cycle_network tag (e.g. "CA:ON:Ottawa") if any —
 *                      presence strongly signals a cycleway-network structure
 *                      and routes to Bikeways regardless of member MUP count.
 */
export function classifyNetwork(
  entryType: string,
  network: string | undefined,
  memberPathTypes: string[],
  cycleNetwork?: string,
): BrowseCategory {
  if (entryType === 'long-distance') return 'long_distance_trails';

  if (memberPathTypes.length === 0) return 'pathways';

  const mtbCount = memberPathTypes.filter(pt => pt === 'mtb-trail').length;
  if (mtbCount / memberPathTypes.length >= MTB_NETWORK_THRESHOLD) return 'mtb';

  // OSM network-structure signals: `network=lcn` (local cycle network)
  // always signals bikeways. `cycle_network` is more ambiguous — NCC's
  // regional pathway system uses it (`CA:ON:NCC`) as does Ottawa's local
  // bikeway system (`CA:ON:Ottawa`). Scope to municipality-suffixed values
  // (Capitalized city name, not an all-caps agency code) to distinguish.
  if (network === 'lcn') return 'bikeways';
  if (cycleNetwork && isMunicipalCycleNetwork(cycleNetwork)) return 'bikeways';

  // Bikeways by member character: no network-structure signal, but the
  // members are mostly bike-lane-class. MUP anchor below overrides for
  // pathway-dominated mixed networks (NCC Greenbelt).
  const mupCount = memberPathTypes.filter(pt => pt === 'mup').length;
  if (mupCount >= PATHWAYS_ANCHOR_MUP_COUNT) return 'pathways';

  const bikewayCount = memberPathTypes.filter(pt => BIKEWAY_PATH_TYPES.has(pt)).length;
  if (bikewayCount / memberPathTypes.length >= 0.5) return 'bikeways';

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

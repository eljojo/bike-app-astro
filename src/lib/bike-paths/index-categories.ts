/**
 * Category classification for the bike paths index page.
 *
 * Extracted verbatim from index.astro for testability.
 * Both index.astro and tests import from here — single source of truth.
 */

export type BrowseCategory = 'pathways' | 'mtb' | 'trails' | 'bikeways';

export const TIER1_MIN_KM = 3;

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
  if (memberPathTypes.length === 0) return 'pathways';

  const mtbCount = memberPathTypes.filter(pt => pt === 'mtb-trail').length;
  if (mtbCount / memberPathTypes.length >= 0.5) return 'mtb';

  if (entryType === 'long-distance') return 'trails';
  if (network === 'lcn') return 'bikeways';
  return 'pathways';
}

/**
 * Classify a standalone path (not in any network) into a browse tab category.
 * Returns null for paths that go to the "all" tab (uncategorized).
 */
export function classifyIndependentPath(
  entryType: string,
  pathType?: string,
): BrowseCategory | null {
  if (entryType === 'long-distance') return 'trails';
  if (pathType === 'mtb-trail') return 'mtb';
  if (pathType === 'trail') return 'trails';
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

import type { SluggedBikePathYml } from './bikepaths-yml';

const EXCLUDED_HIGHWAYS = new Set([
  'tertiary', 'secondary', 'primary', 'residential',
  'unclassified', 'footway', 'pedestrian',
]);

const EXCLUDED_NETWORKS = new Set([
  'mtb', 'lwn', 'rwn',
]);

// Matches "Bridge" or "Footbridge" at the END of a name,
// or "Pont" at the START of a name. Does NOT match mid-name
// occurrences like "Bridge Street Pathway".
const BRIDGE_PATTERN = /(?:^pont\b|(?:\b(?:bridge|footbridge))$)/i;

const NUMERIC_ONLY = /^\d+$/;
const RELATION_ID = /^relation-\d+$/;

export function isHardExcluded(entry: SluggedBikePathYml): boolean {
  if (entry.highway && EXCLUDED_HIGHWAYS.has(entry.highway)) return true;
  if (entry.network && EXCLUDED_NETWORKS.has(entry.network)) return true;
  if (entry.seasonal === 'winter') return true;
  if (NUMERIC_ONLY.test(entry.name)) return true;
  if (RELATION_ID.test(entry.name)) return true;
  if (BRIDGE_PATTERN.test(entry.name)) return true;
  return false;
}

export function scoreBikePath(entry: SluggedBikePathYml, routeOverlapCount: number): number {
  let score = 0;
  if (entry.osm_relations && entry.osm_relations.length > 0) score += 3;
  if (entry.network === 'rcn' || entry.network === 'ncn') score += 3;
  if (routeOverlapCount > 0) score += 3;
  if (entry.operator) score += 2;
  if (entry.website || entry.wikidata) score += 2;
  if (entry.highway === 'cycleway') score += 1;
  if (entry.name_en && entry.name_fr) score += 1;
  if (entry.surface === 'asphalt') score += 1;
  return score;
}

export const SCORE_THRESHOLD = 4;

/**
 * Minimum score for Tier 1 pre-filtering (before route overlaps are known).
 * Route overlap adds up to +3, so entries scoring at least SCORE_THRESHOLD - 3
 * could pass after enrichment. We keep them as candidates to avoid false negatives.
 */
export const TIER1_MIN_SCORE = Math.max(SCORE_THRESHOLD - 3, 1);

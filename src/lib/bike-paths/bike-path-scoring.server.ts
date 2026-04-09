import type { SluggedBikePathYml } from './bikepaths-yml.server';
import { supportedLocales } from '../i18n/locale-utils';

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
  // Network and trail entries are explicitly modeled — never hard-exclude them.
  // The rules below are for filtering individual path entries from OSM.
  if (entry.type === 'network' || entry.type === 'long-distance') return false;
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
  const locales = supportedLocales();
  const translatedCount = locales.filter(loc => (entry as Record<string, unknown>)[`name_${loc}`]).length;
  if (translatedCount >= 2) score += 1;
  if (entry.surface === 'asphalt') score += 1;
  return score;
}

export const SCORE_THRESHOLD = 4;

/**
 * Destination rule: a path gets a standalone page based on its pipeline `type`.
 * `network` and `destination` entries get pages; `infrastructure` and `connector`
 * entries do not (they appear on the map or in listings but have no detail page).
 * Markdown always overrides: hasMarkdown forces a page, hidden suppresses one.
 *
 * `standalone` is the SINGLE SOURCE OF TRUTH for "does this have a page?"
 * Every consumer (sitemap, map popups, nearby paths, etc.) checks this.
 */
export function isDestination(
  entry: SluggedBikePathYml,
  hasMarkdown: boolean,
  hidden: boolean,
): boolean {
  if (hidden) return false;
  if (hasMarkdown) return true;
  if (entry.type === 'network') return true;
  if (entry.type === 'long-distance') return true;
  if (entry.type === 'destination') return true;
  return false;
}

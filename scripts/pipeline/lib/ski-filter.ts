// scripts/pipeline/lib/ski-filter.ts
//
// Predicate that identifies ski-only ways (Nordic pistes, hiking-only
// paths) so we don't promote them as bike path entries. See
// _ctx/tag-propagation.md for context.
//
// Pure Nordic/piste infrastructure (e.g. Parc de la Gatineau's numbered
// pistes) was slipping into bikepaths.yml via junction-node lookups. Ski
// trails must not become bike path entries.

/**
 * A way is ski-only when it has explicit bicycle=no, or when it is a
 * path/footway carrying a `piste:type` / `piste:name` tag without explicit
 * cycling permission (bicycle=designated|yes). highway=cycleway is implicitly
 * bicycle=designated by OSM convention and never counts as ski-only even if
 * groomed in winter. Roads (highway=residential|tertiary|…) have implicit
 * cycling access and are never classified as ski-only on piste tags alone.
 */
export function isSkiOnlyWay(tags: Record<string, any> | undefined): boolean {
  if (!tags) return false;
  if (tags.bicycle === 'no') return true;
  // The piste filter only applies to path/footway highways. Cycleways are
  // implicit cycling infrastructure; roads have implicit bike access.
  if (tags.highway !== 'path' && tags.highway !== 'footway') return false;
  const isPiste = tags['piste:type'] || tags['piste:name'];
  if (!isPiste) return false;
  return tags.bicycle !== 'designated' && tags.bicycle !== 'yes';
}

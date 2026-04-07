/**
 * Surface taxonomy for bike paths.
 *
 * Two independent classifications:
 * - SURFACE_CATEGORIES: display taxonomy (what category to show in the UI)
 * - UNPAVED: rideability taxonomy (is a road bike appropriate?)
 *
 * These are NOT derived from each other. `wood` maps to `boardwalk` for
 * display but is NOT unpaved — boardwalks are rideable on a road bike.
 *
 * Browser-safe — no .server.ts, no node:* imports.
 */

/** Maps OSM surface values to display category keys. */
export const SURFACE_CATEGORIES: Record<string, string> = {
  asphalt: 'paved',
  concrete: 'paved',
  paved: 'paved',
  paving_stones: 'paved',
  fine_gravel: 'gravel',
  gravel: 'gravel',
  compacted: 'gravel',
  ground: 'dirt',
  dirt: 'dirt',
  earth: 'dirt',
  sand: 'dirt',
  mud: 'dirt',
  grass: 'dirt',
  woodchips: 'dirt',
  unpaved: 'dirt',
  'dirt/sand': 'dirt',
  wood: 'boardwalk',
};

/** Surfaces that are not road-bike-friendly. Explicit set, not derived from SURFACE_CATEGORIES. */
export const UNPAVED = new Set([
  'ground', 'gravel', 'dirt', 'earth', 'grass', 'sand', 'mud',
  'compacted', 'fine_gravel', 'woodchips', 'unpaved', 'dirt/sand',
]);

export function isUnpaved(surface?: string): boolean {
  return !!surface && UNPAVED.has(surface);
}

export function isPaved(surface?: string): boolean {
  return !!surface && !UNPAVED.has(surface);
}

/** Maintained unpaved surfaces: rideable on a hybrid/gravel bike, not MTB terrain. */
const MAINTAINED_UNPAVED = new Set(['fine_gravel', 'compacted']);

export function isMaintainedUnpaved(surface?: string): boolean {
  return !!surface && MAINTAINED_UNPAVED.has(surface);
}

/** Returns category key for known surfaces, or the raw value for unknown ones. */
export function displaySurface(raw?: string): string | undefined {
  if (!raw) return undefined;
  return SURFACE_CATEGORIES[raw] || raw;
}

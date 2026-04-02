/**
 * Shared bike-path fact helpers — locale-independent.
 *
 * These functions extract structured facts from bike path metadata.
 * Views are responsible for localizing the output (mapping keys to
 * translated strings via `t()`).
 *
 * Browser-safe — no .server.ts, no node:* imports.
 */

/** Maps OSM surface values to display category keys. */
export const SURFACE_CATEGORIES: Record<string, string> = {
  asphalt: 'paved',
  concrete: 'paved',
  fine_gravel: 'gravel',
  gravel: 'gravel',
  compacted: 'gravel',
  ground: 'dirt',
  dirt: 'dirt',
};

/** Returns category key for known surfaces, or the raw value for unknown ones. */
export function displaySurface(raw?: string): string | undefined {
  if (!raw) return undefined;
  return SURFACE_CATEGORIES[raw] || raw;
}

/** Maps OSM network codes to i18n key suffixes. */
export const NETWORK_LABELS: Record<string, string> = {
  rcn: 'network_regional',
  ncn: 'network_national',
  lcn: 'network_local',
};

/** Average lat/lng of a set of points. */
export function computeCenter(pts: Array<{ lat: number; lng: number }>): [number, number] | undefined {
  if (pts.length === 0) return undefined;
  const lat = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
  const lng = pts.reduce((s, p) => s + p.lng, 0) / pts.length;
  return [lat, lng];
}

/** A structured fact about a bike path — key + optional value. Views localize these. */
export interface PathFact {
  key: string;
  value?: string;
}

/** Input metadata for buildPathFacts. Mirrors the relevant fields from BikePathPage. */
interface PathMeta {
  surface?: string;
  width?: string;
  highway?: string;
  segregated?: string;
  lit?: string;
  elevation_gain_m?: number;
  operator?: string;
  network?: string;
}

/**
 * Build structured facts from path metadata.
 *
 * Returns `PathFact[]` with locale-independent keys and optional values.
 * The view layer is responsible for mapping these to localized strings.
 */
export function buildPathFacts(meta: PathMeta): PathFact[] {
  const facts: PathFact[] = [];

  // Surface + width combined
  const surfaceCategory = meta.surface ? (SURFACE_CATEGORIES[meta.surface] || meta.surface) : undefined;
  if (surfaceCategory && meta.width) {
    facts.push({ key: 'surface_width', value: `${surfaceCategory}:${meta.width}` });
  } else if (surfaceCategory) {
    facts.push({ key: 'surface', value: surfaceCategory });
  } else if (meta.width) {
    facts.push({ key: 'width', value: meta.width });
  }

  // Separated from cars (cycleway = dedicated infrastructure)
  if (meta.highway === 'cycleway') {
    facts.push({ key: 'separated_cars' });
  }

  // Separated from pedestrians
  if (meta.segregated === 'yes') {
    facts.push({ key: 'separated_peds' });
  }

  // Lit
  if (meta.lit === 'yes') {
    facts.push({ key: 'lit' });
  } else if (meta.lit === 'no') {
    facts.push({ key: 'not_lit' });
  }

  // Elevation
  if (meta.elevation_gain_m != null) {
    if (meta.elevation_gain_m < 20) {
      facts.push({ key: 'flat' });
    } else if (meta.elevation_gain_m < 80) {
      facts.push({ key: 'gentle_hills', value: String(meta.elevation_gain_m) });
    } else {
      facts.push({ key: 'hilly', value: String(meta.elevation_gain_m) });
    }
  }

  // Operator
  if (meta.operator) {
    facts.push({ key: 'operator', value: meta.operator });
  }

  // Network
  if (meta.network && NETWORK_LABELS[meta.network]) {
    facts.push({ key: NETWORK_LABELS[meta.network] });
  }

  return facts;
}

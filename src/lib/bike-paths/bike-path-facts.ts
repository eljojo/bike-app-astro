/**
 * Shared bike-path fact helpers.
 *
 * Extracts structured facts from bike path metadata and provides
 * localization helpers for views. The single source of truth for
 * what facts a bike path page shows and how they're displayed.
 *
 * Browser-safe — no .server.ts, no node:* imports.
 */

/** Minimal translator type — compatible with the `t()` function from @/i18n. */
export type Translator = (key: string, locale?: string, vars?: Record<string, string | number>) => string;

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
  smoothness?: string;
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

  // Surface — show actual value (e.g. 'fine_gravel'), not category
  if (meta.surface && meta.width) {
    facts.push({ key: 'surface_width', value: `${meta.surface}:${meta.width}` });
  } else if (meta.surface) {
    facts.push({ key: 'surface', value: meta.surface });
  } else if (meta.width) {
    facts.push({ key: 'width', value: meta.width });
  }

  // Smoothness
  if (meta.smoothness) {
    facts.push({ key: `smoothness_${meta.smoothness}` });
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

// ---------------------------------------------------------------------------
// Localization helpers — views pass their `t` function in
// ---------------------------------------------------------------------------

/** Returns the i18n label key for a fact's table row (e.g. "paths.label.surface"). */
export function factLabelKey(factKey: string): string {
  if (factKey === 'surface_width' || factKey === 'surface' || factKey === 'width') return 'paths.label.surface';
  if (factKey.startsWith('smoothness_')) return 'paths.label.surface_quality';
  if (factKey === 'separated_cars' || factKey === 'separated_peds') return 'paths.label.separated';
  if (factKey === 'lit' || factKey === 'not_lit') return 'paths.label.lit';
  if (factKey === 'flat' || factKey === 'gentle_hills' || factKey === 'hilly') return 'paths.label.terrain';
  if (factKey === 'operator') return 'paths.label.operator';
  if (factKey.startsWith('network_')) return 'paths.label.network';
  return `paths.label.${factKey}`;
}

/** Localize a fact's value for table display. */
export function localizeFactValue(fact: PathFact, t: Translator, locale?: string): string {
  switch (fact.key) {
    case 'surface_width': {
      const [surface, width] = (fact.value || '').split(':');
      const surfaceStr = localizeSurface(surface, t, locale) || surface;
      return `${surfaceStr}, ${width}m`;
    }
    case 'surface':
      return localizeSurface(fact.value, t, locale) || fact.value || '';
    case 'width':
      return `${fact.value}m`;
    case 'operator':
      return fact.value || '';
    case 'gentle_hills':
      return t('paths.fact.gentle_hills', locale, { meters: fact.value || '' });
    case 'hilly':
      return t('paths.fact.hilly', locale, { meters: fact.value || '' });
    default: {
      const i18nKey = `paths.fact.${fact.key}`;
      const translated = t(i18nKey, locale);
      return translated !== i18nKey ? translated : fact.key;
    }
  }
}

/** Localize a fact as a full sentence (for SEO descriptions). */
export function localizeFactSentence(fact: PathFact, t: Translator, locale?: string): string {
  if (fact.key === 'surface_width') {
    const [surface, width] = (fact.value || '').split(':');
    const surfaceStr = localizeSurface(surface, t, locale) || surface;
    return `${surfaceStr}, ${width}m ${t('paths.fact.wide', locale)}`;
  }
  if (fact.key === 'width') {
    return `${fact.value}m ${t('paths.fact.wide', locale)}`;
  }
  if (fact.key === 'operator') {
    return t('paths.fact.maintained', locale, { operator: fact.value || '' });
  }
  return localizeFactValue(fact, t, locale);
}

/** Localize a raw OSM surface value (e.g. "fine_gravel" → "Gravel"). */
export function localizeSurface(raw: string | undefined, t: Translator, locale?: string): string | undefined {
  const cat = displaySurface(raw);
  if (!cat) return undefined;
  const i18nKey = `paths.fact.${cat}`;
  const translated = t(i18nKey, locale);
  return translated !== i18nKey ? translated : cat;
}

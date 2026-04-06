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
  paved: 'paved',
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
  wood: 'boardwalk',
  paving_stones: 'paved',
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
export interface PathMeta {
  surface?: string;
  smoothness?: string;
  width?: string;
  highway?: string;
  segregated?: string;
  lit?: string;
  elevation_gain_m?: number;
  operator?: string;
  network?: string;
  mtb?: boolean;
  path_type?: string;
  seasonal?: string;
  ref?: string;
  inception?: string;
  bicycle?: string;
  cycleway?: string;
  parallel_to?: string;
  overlapping_relations?: Array<{ id: number; name: string; route: string; operator?: string }>;
}

/**
 * Build structured facts from path metadata.
 *
 * Returns `PathFact[]` with locale-independent keys and optional values.
 * The view layer is responsible for mapping these to localized strings.
 */
/** Sanitize width — reject outrageous values from OSM data. */
function sanitizeWidth(raw?: string): string | undefined {
  if (!raw) return undefined;
  if (!/^\d+(\.\d+)?$/.test(raw.trim())) return undefined; // must be a plain number
  const n = parseFloat(raw);
  if (isNaN(n)) return undefined;
  if (n < 0.3) return undefined;          // <30cm is not a real path width
  if (n > 6) return undefined;            // >6m is likely the road width, not the bike lane
  return String(n);
}

export function buildPathFacts(meta: PathMeta): PathFact[] {
  const facts: PathFact[] = [];

  const width = sanitizeWidth(meta.width);

  // Path info — combined path_type + surface + width in one row.
  // Value format: "path_type:surface:width" (any part can be empty).
  // The view layer parses and localizes each component.
  if (meta.path_type || meta.surface || width) {
    facts.push({ key: 'path_info', value: `${meta.path_type || ''}:${meta.surface || ''}:${width || ''}` });
  }

  // Smoothness
  if (meta.smoothness) {
    facts.push({ key: `smoothness_${meta.smoothness}` });
  }

  // Traffic — combined separation + unusual access restrictions.
  // Normal bicycle access (yes, designated) is redundant on a bike site — not shown.
  const sepCars = meta.highway === 'cycleway';
  const sepPeds = meta.segregated === 'yes';
  if (sepCars && sepPeds) {
    facts.push({ key: 'traffic_separated_all' });
  } else if (sepCars) {
    facts.push({ key: 'traffic_separated_cars' });
  } else if (sepPeds) {
    facts.push({ key: 'traffic_separated_peds' });
  }
  // Unusual restrictions only — but mtb:true overrides bicycle:no
  // (OSM bicycle:no on mtb trails means "no road bikes", not "no bikes")
  if (meta.bicycle === 'no' && !meta.mtb) {
    facts.push({ key: 'traffic_no_bikes' });
  } else if (meta.bicycle === 'dismount') {
    facts.push({ key: 'traffic_dismount' });
  }

  // Parallel to road
  if (meta.parallel_to) {
    facts.push({ key: 'parallel_to', value: meta.parallel_to });
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

  // Seasonal
  if (meta.seasonal) {
    facts.push({ key: 'seasonal', value: meta.seasonal });
  }

  // Reference code
  if (meta.ref) {
    facts.push({ key: 'ref', value: meta.ref });
  }

  // Inception / Established
  if (meta.inception) {
    facts.push({ key: 'inception', value: meta.inception });
  }

  return facts;
}

// ---------------------------------------------------------------------------
// Network fact aggregation — inherit from members when consistent
// ---------------------------------------------------------------------------

/**
 * Consistency of a fact across network members:
 * - unanimous: every member has this fact with the same value
 * - partial:   some members have this fact, but those who do all agree
 * - mixed:     members disagree (different values for the same category)
 */
export type FactConsistency = 'unanimous' | 'partial' | 'mixed';

export interface NetworkFact extends PathFact {
  consistency: FactConsistency;
  /** For mixed facts: breakdown of values with counts. */
  breakdown?: Array<{ value: string; count: number }>;
}

/**
 * Aggregate facts from network member paths.
 *
 * Analyzes each fact category across all members. When members agree,
 * the network inherits the fact. When they disagree, the fact explains
 * the variation. Categories where no member has data are omitted.
 */
export function buildNetworkFacts(members: PathMeta[]): NetworkFact[] {
  if (members.length === 0) return [];
  const facts: NetworkFact[] = [];

  // --- Path type ---
  const pathTypes = members.filter(m => m.path_type).map(m => m.path_type!);
  if (pathTypes.length > 0) {
    const unique = [...new Set(pathTypes)];
    if (unique.length === 1) {
      facts.push({
        key: 'path_type', value: unique[0],
        consistency: pathTypes.length === members.length ? 'unanimous' : 'partial',
      });
    } else {
      const counts = unique.map(v => ({ value: v, count: pathTypes.filter(pt => pt === v).length }));
      counts.sort((a, b) => b.count - a.count);
      facts.push({ key: 'path_type_mixed', consistency: 'mixed', breakdown: counts });
    }
  }

  // --- Surface ---
  const surfaces = members.filter(m => m.surface).map(m => displaySurface(m.surface)!);
  if (surfaces.length > 0) {
    const unique = [...new Set(surfaces)];
    if (unique.length === 1) {
      facts.push({
        key: 'surface', value: unique[0],
        consistency: surfaces.length === members.length ? 'unanimous' : 'partial',
      });
    } else {
      const counts = unique.map(v => ({ value: v, count: surfaces.filter(s => s === v).length }));
      counts.sort((a, b) => b.count - a.count);
      facts.push({ key: 'surface_mixed', consistency: 'mixed', breakdown: counts });
    }
  }

  // --- Separated from cars ---
  const cycleways = members.filter(m => m.highway === 'cycleway').length;
  const nonCycleways = members.filter(m => m.highway && m.highway !== 'cycleway').length;
  if (cycleways > 0 && nonCycleways === 0) {
    facts.push({
      key: 'separated_cars',
      consistency: cycleways === members.length ? 'unanimous' : 'partial',
    });
  }

  // --- Lit ---
  const litYes = members.filter(m => m.lit === 'yes').length;
  const litNo = members.filter(m => m.lit === 'no').length;
  if (litYes > 0 && litNo === 0) {
    facts.push({ key: 'lit', consistency: litYes === members.length ? 'unanimous' : 'partial' });
  } else if (litNo > 0 && litYes === 0) {
    facts.push({ key: 'not_lit', consistency: litNo === members.length ? 'unanimous' : 'partial' });
  } else if (litYes > 0 && litNo > 0) {
    facts.push({
      key: 'lit_mixed', consistency: 'mixed',
      breakdown: [{ value: 'lit', count: litYes }, { value: 'not_lit', count: litNo }],
    });
  }

  // --- Operator ---
  const operators = members.filter(m => m.operator).map(m => m.operator!);
  if (operators.length > 0) {
    const unique = [...new Set(operators)];
    if (unique.length === 1) {
      facts.push({
        key: 'operator', value: unique[0],
        consistency: operators.length === members.length ? 'unanimous' : 'partial',
      });
    }
    // Mixed operators: skip — network page already shows its own operator field
  }

  // --- Parallel to road ---
  const parallelCount = members.filter(m => m.parallel_to).length;
  if (parallelCount > 0 && parallelCount < members.length) {
    facts.push({ key: 'some_parallel', consistency: 'partial' });
  } else if (parallelCount === members.length) {
    facts.push({ key: 'all_parallel', consistency: 'unanimous' });
  }

  return facts;
}

// ---------------------------------------------------------------------------
// Localization helpers — views pass their `t` function in
// ---------------------------------------------------------------------------

/** Returns the i18n label key for a fact's table row (e.g. "paths.label.surface"). */
export function factLabelKey(factKey: string): string {
  if (factKey === 'path_info' || factKey === 'path_type' || factKey === 'path_type_mixed') return 'paths.label.path_type';
  if (factKey === 'surface_width' || factKey === 'surface' || factKey === 'width' || factKey === 'surface_mixed') return 'paths.label.surface';
  if (factKey.startsWith('smoothness_')) return 'paths.label.surface_quality';
  if (factKey.startsWith('traffic_')) return 'paths.label.separated';
  if (factKey === 'separated_cars' || factKey === 'separated_peds') return 'paths.label.separated';
  if (factKey === 'parallel_to') return 'paths.label.parallel_to';
  if (factKey === 'some_parallel' || factKey === 'all_parallel') return 'paths.label.parallel_to';
  if (factKey === 'lit' || factKey === 'not_lit' || factKey === 'lit_mixed') return 'paths.label.lit';
  if (factKey === 'flat' || factKey === 'gentle_hills' || factKey === 'hilly') return 'paths.label.terrain';
  if (factKey === 'operator') return 'paths.label.operator';
  if (factKey.startsWith('network_')) return 'paths.label.network';
  if (factKey === 'seasonal') return 'paths.label.seasonal';
  if (factKey === 'ref') return 'paths.label.ref';
  if (factKey === 'inception') return 'paths.label.established';
  if (factKey === 'overlapping_relation') return 'paths.label.also_part_of';
  return `paths.label.${factKey}`;
}

/** Localize a fact's value for table display. */
export function localizeFactValue(fact: PathFact, t: Translator, locale?: string): string {
  switch (fact.key) {
    case 'path_info': {
      // Value format: "path_type:surface:width" — parse and localize each part
      const [pt, surface, width] = (fact.value || '').split(':');
      const parts: string[] = [];
      if (pt) {
        const ptKey = `paths.fact.${pt.replace(/-/g, '_')}`;
        const ptTranslated = t(ptKey, locale);
        parts.push(ptTranslated !== ptKey ? ptTranslated : pt);
      }
      const surfDetail: string[] = [];
      if (surface) surfDetail.push(localizeSurface(surface, t, locale) || surface);
      if (width) surfDetail.push(`${width}m`);
      if (surfDetail.length > 0) parts.push(surfDetail.join(', '));
      return parts.join(' · ');
    }
    case 'path_type': {
      const i18nKey = `paths.fact.${(fact.value || '').replace(/-/g, '_')}`;
      const translated = t(i18nKey, locale);
      return translated !== i18nKey ? translated : fact.value || '';
    }
    case 'surface_width': {
      const [surface, width] = (fact.value || '').split(':');
      const surfaceStr = localizeSurface(surface, t, locale) || surface;
      return `${surfaceStr}, ${width}m`;
    }
    case 'surface':
      return localizeSurface(fact.value, t, locale) || fact.value || '';
    case 'width':
      return `${fact.value}m`;
    case 'traffic_separated_all':
      return t('paths.fact.separated_all', locale);
    case 'traffic_separated_cars':
      return t('paths.fact.separated_cars', locale);
    case 'traffic_separated_peds':
      return t('paths.fact.separated_peds', locale);
    case 'traffic_no_bikes':
      return t('paths.fact.no_bikes', locale);
    case 'traffic_dismount':
      return t('paths.fact.dismount', locale);
    case 'parallel_to':
      return fact.value || '';
    case 'operator':
      return fact.value || '';
    case 'seasonal':
      return t(`paths.fact.seasonal_${fact.value}`, locale);
    case 'ref':
    case 'inception':
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

/** Localize a network fact's value, handling mixed/partial consistency. */
export function localizeNetworkFactValue(fact: NetworkFact, t: Translator, locale?: string): string {
  // Mixed path type: "Multi-use pathway (3), Bike lane (2)"
  if (fact.key === 'path_type_mixed' && fact.breakdown) {
    return fact.breakdown
      .map(b => {
        const i18nKey = `paths.fact.${b.value.replace(/-/g, '_')}`;
        const translated = t(i18nKey, locale);
        return `${translated !== i18nKey ? translated : b.value} (${b.count})`;
      })
      .join(', ');
  }

  // Mixed surface: "Paved (3), Gravel (2)"
  if (fact.key === 'surface_mixed' && fact.breakdown) {
    return fact.breakdown
      .map(b => {
        const label = localizeSurface(b.value, t, locale) || b.value;
        return `${label} (${b.count})`;
      })
      .join(', ');
  }

  // Mixed lit: "Some lit, some not"
  if (fact.key === 'lit_mixed') {
    return t('paths.fact.partially_lit', locale);
  }

  // For unanimous/partial, use the regular localization
  return localizeFactValue(fact, t, locale);
}

/** Nearby/connected path reference — the shape used by PathRelations. */
export interface NearbyPathRef {
  slug: string;
  name: string;
  surface?: string;
  memberOf?: string;
  length_km?: number;
}

/**
 * Find the nearest major path — the most significant path close to this one.
 * Combines connected + nearby paths (including same-network siblings),
 * dedupes, and picks the longest one that's bigger than the current path.
 *
 * Returns undefined for network pages (they don't need this) or when
 * no candidate is substantially longer.
 */
export function findNearestMajorPath(opts: {
  connectedPaths: NearbyPathRef[];
  nearbyPaths: NearbyPathRef[];
  pageSlug: string;
  pageLengthKm?: number;
  pageMemberOf?: string;
  hasMembers: boolean;
  memberSlugs: Set<string>;
}): NearbyPathRef | undefined {
  if (opts.hasMembers) return undefined;
  const seen = new Set<string>();
  const candidates: NearbyPathRef[] = [];
  for (const p of [...opts.connectedPaths, ...opts.nearbyPaths]) {
    if (seen.has(p.slug)) continue;
    seen.add(p.slug);
    if (opts.memberSlugs.has(p.slug)) continue;
    if (p.slug === opts.pageSlug) continue;
    if (p.slug === opts.pageMemberOf) continue; // exclude own parent network
    if ((p.length_km ?? 0) <= (opts.pageLengthKm ?? 0)) continue;
    candidates.push(p);
  }
  candidates.sort((a, b) => (b.length_km ?? 0) - (a.length_km ?? 0));
  return candidates[0] ?? undefined;
}

/** Localize a raw OSM surface value (e.g. "fine_gravel" → "Gravel"). */
export function localizeSurface(raw: string | undefined, t: Translator, locale?: string): string | undefined {
  const cat = displaySurface(raw);
  if (!cat) return undefined;
  const i18nKey = `paths.fact.${cat}`;
  const translated = t(i18nKey, locale);
  return translated !== i18nKey ? translated : cat;
}

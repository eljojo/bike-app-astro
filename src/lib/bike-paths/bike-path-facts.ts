/**
 * Shared bike-path fact helpers.
 *
 * Extracts structured facts from bike path metadata and provides
 * localization helpers for views. The single source of truth for
 * what facts a bike path page shows and how they're displayed.
 *
 * Browser-safe — no .server.ts, no node:* imports.
 */

// Re-export from surfaces.ts for backwards compatibility
export { SURFACE_CATEGORIES, displaySurface } from './surfaces.ts';

import { displaySurface, isPaved } from './surfaces.ts';
import { isSeparatedFromCars, isExplicitMtb } from './classify-path.ts';

/** Minimal translator type — compatible with the `t()` function from @/i18n. */
export type Translator = (key: string, locale?: string, vars?: Record<string, string | number>) => string;

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
  /** For mixed facts: breakdown of values with distance. */
  breakdown?: Array<{ value: string; count?: number; km?: number }>;
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
  length_km?: number;
  operator?: string;
  network?: string;
  mtb?: boolean;
  'mtb:scale'?: string | number;
  'mtb:scale:imba'?: string | number;
  path_type?: string;
  seasonal?: string;
  ref?: string;
  inception?: string;
  bicycle?: string;
  cycleway?: string;
  parallel_to?: string;
  foot?: string;
  incline?: string;
  access?: string;
  route_type?: string;
  /** Park name from OSM containment. */
  park?: string;
  overlapping_relations?: Array<{ id: number; name: string; route: string; operator?: string; wikipedia?: string; website?: string }>;
  surface_mix?: Array<{ value: string; km: number }>;
  lit_mix?: Array<{ value: string; km: number }>;
}

/**
 * Build structured facts from path metadata.
 *
 * Returns `PathFact[]` with locale-independent keys and optional values.
 * The view layer is responsible for mapping these to localized strings.
 */
/** Parse OSM incline tag to a numeric percentage. Returns null for qualitative values like "up"/"down". */
function parseInclinePercent(raw: string): number | null {
  const m = raw.match(/[<>]?\s*(-?\d+(?:\.\d+)?)\s*%/);
  if (!m) return null;
  return Math.abs(parseFloat(m[1]));
}

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

/**
 * Auto-detect family-friendly paths from OSM metadata.
 * A paved MUP separated from cars is safe for beginners and families.
 * Park paths get a lower bar — lighting not required since parks are
 * inherently low-stress environments for daytime family rides.
 */
function isFamilyFriendly(meta: PathMeta): boolean {
  if (meta.path_type !== 'mup') return false;
  if (meta.mtb) return false;
  if (!isPaved(meta.surface)) return false;
  // Park paths: paved MUP is enough
  if (meta.park) return true;
  // Non-park paths: also require lighting
  if (meta.lit !== 'yes') return false;
  return true;
}

export function buildPathFacts(meta: PathMeta): PathFact[] {
  const facts: PathFact[] = [];

  const width = sanitizeWidth(meta.width);
  const hasSurfaceMix = meta.surface_mix && meta.surface_mix.length > 1;

  // Path info — path_type + width only. Surface is shown separately to avoid
  // redundancy (e.g. "Multi-use pathway · Paved" + "Surface: Paved (10 km)").
  // Value format: "path_type::width" (surface slot left empty).
  if (meta.path_type || width) {
    facts.push({ key: 'path_info', value: `${meta.path_type || ''}::${width || ''}` });
  }

  // Family-friendly — shown early (before surface) because it's the most
  // important signal for someone deciding whether to ride here.
  if (isFamilyFriendly(meta)) {
    facts.push({ key: 'family_friendly' });
  }

  // Surface — smoothness is integrated as an adjective on the surface name
  // when it tells you something you wouldn't expect:
  //   - "excellent" on paved → "Smooth pavement" (great for road bikes)
  //   - "intermediate" or worse → "Uneven pavement", "Rough gravel" (bring right tires)
  //   - "good" → drop (expected default)
  //   - "excellent" on unpaved → drop ("smooth gravel" sounds wrong)
  // For mixed surfaces: only show smoothness as a separate warning when bad+.
  const SMOOTHNESS_ADJECTIVES: Record<string, string> = {
    intermediate: 'uneven', bad: 'rough', very_bad: 'very_rough',
    horrible: 'extremely_rough', impassable: 'impassable',
  };
  const smoothnessAdj = meta.smoothness ? SMOOTHNESS_ADJECTIVES[meta.smoothness] : undefined;
  const showSmooth = meta.smoothness === 'excellent' && isPaved(meta.surface);
  // Combine smoothness into the surface fact when single surface
  const surfaceSmoothness = smoothnessAdj ? smoothnessAdj : showSmooth ? 'smooth' : undefined;

  if (hasSurfaceMix) {
    facts.push({
      key: 'surface_mixed',
      breakdown: meta.surface_mix!.map(m => ({ value: m.value, km: m.km })),
    });
    // For mixed surfaces, only warn about bad+ conditions as a separate fact
    if (smoothnessAdj) {
      facts.push({ key: `smoothness_${meta.smoothness}` });
    }
  } else if (meta.surface) {
    // Single surface — smoothness becomes an adjective: "Smooth pavement", "Rough gravel"
    facts.push({ key: 'surface', value: meta.surface, ...(surfaceSmoothness ? { breakdown: [{ value: surfaceSmoothness, km: 0 }] } : {}) });
  } else if (smoothnessAdj) {
    // No surface known, but smoothness is a warning — show standalone
    facts.push({ key: `smoothness_${meta.smoothness}` });
  }

  // Traffic — combined separation + unusual access restrictions.
  // Normal bicycle access (yes, designated) is redundant on a bike site — not shown.
  const sepCars = isSeparatedFromCars(meta);
  // Pedestrian separation: explicit segregation, foot=no (bikes only),
  // or access=no with bicycle explicitly allowed (bike-only facility).
  const bikeOnly = meta.access === 'no' && (meta.bicycle === 'designated' || meta.bicycle === 'yes');
  const sepPeds = meta.segregated === 'yes' || meta.foot === 'no' || bikeOnly;
  if (sepCars && sepPeds) {
    facts.push({ key: 'traffic_separated_all' });
  } else if (sepCars) {
    facts.push({ key: 'traffic_separated_cars' });
  } else if (sepPeds) {
    facts.push({ key: 'traffic_separated_peds' });
  }
  // Unusual restrictions only — MTB overrides bicycle:no
  // (OSM bicycle:no on mtb trails means "no road bikes", not "no bikes")
  if (meta.bicycle === 'no' && !meta.mtb && !isExplicitMtb(meta)) {
    facts.push({ key: 'traffic_no_bikes' });
  } else if (meta.bicycle === 'dismount') {
    facts.push({ key: 'traffic_dismount' });
  }

  // Parallel to road
  if (meta.parallel_to) {
    facts.push({ key: 'parallel_to', value: meta.parallel_to });
  }

  // Lit — use distribution when available
  if (meta.lit_mix && meta.lit_mix.some(m => m.value === 'yes') && meta.lit_mix.some(m => m.value === 'no')) {
    facts.push({
      key: 'lit_mixed',
      breakdown: meta.lit_mix.map(m => ({ value: m.value, km: m.km })),
    });
  } else if (meta.lit === 'yes') {
    facts.push({ key: 'lit' });
  } else if (meta.lit === 'no') {
    facts.push({ key: 'not_lit' });
  }

  // Elevation — GPX-derived elevation_gain_m is authoritative. When unavailable,
  // fall back to OSM incline tag (grade percentage or qualitative up/down).
  if (meta.elevation_gain_m != null) {
    if (meta.elevation_gain_m < 20) {
      facts.push({ key: 'flat' });
    } else if (meta.elevation_gain_m < 80) {
      facts.push({ key: 'gentle_hills', value: String(meta.elevation_gain_m) });
    } else {
      facts.push({ key: 'hilly', value: String(meta.elevation_gain_m) });
    }
  } else if (meta.incline) {
    const pct = parseInclinePercent(meta.incline);
    if (pct !== null) {
      if (pct < 2) facts.push({ key: 'flat' });
      else if (pct < 6) facts.push({ key: 'gentle_hills' });
      else facts.push({ key: 'hilly' });
    } else if (meta.incline === 'up' || meta.incline === 'down') {
      facts.push({ key: 'gentle_hills' });
    }
  }

  // Operator
  if (meta.operator) {
    facts.push({ key: 'operator', value: meta.operator });
  }

  // Network — suppress for non-cycling relations (e.g. route=foot with network=lcn
  // means "local walking network", not "local cycling network").
  const NON_CYCLING_ROUTE_TYPES = new Set(['foot', 'hiking', 'horse', 'running', 'piste', 'fitness_trail', 'inline_skates', 'ski']);
  if (meta.network && NETWORK_LABELS[meta.network] && !NON_CYCLING_ROUTE_TYPES.has(meta.route_type ?? '')) {
    facts.push({ key: NETWORK_LABELS[meta.network] });
  }

  // Seasonal
  if (meta.seasonal) {
    facts.push({ key: 'seasonal', value: meta.seasonal });
  }

  // Access restrictions — private land or permissive access worth noting.
  // access=no with bicycle allowed is already handled above (bikeOnly → separation).
  if (meta.access === 'private') {
    facts.push({ key: 'access_private' });
  } else if (meta.access === 'permissive') {
    facts.push({ key: 'access_permissive' });
  }

  // Route ref — hidden from the facts table. Available in data but not
  // useful enough for most users to warrant a table row.

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
  /** For mixed facts: breakdown of values with distance (km) or counts. */
  breakdown?: Array<{ value: string; count: number; km?: number }>;
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
  const withPathType = members.filter(m => m.path_type);
  if (withPathType.length > 0) {
    const unique = [...new Set(withPathType.map(m => m.path_type!))];
    if (unique.length === 1) {
      facts.push({
        key: 'path_type', value: unique[0],
        consistency: withPathType.length === members.length ? 'unanimous' : 'partial',
      });
    } else {
      const breakdown = unique.map(v => {
        const matching = withPathType.filter(m => m.path_type === v);
        const km = matching.reduce((s, m) => s + (m.length_km ?? 0), 0);
        return { value: v, count: matching.length, km: Math.round(km * 10) / 10 };
      });
      breakdown.sort((a, b) => (b.km || b.count) - (a.km || a.count));
      facts.push({ key: 'path_type_mixed', consistency: 'mixed', breakdown });
    }
  }

  // --- Surface ---
  const withSurface = members.filter(m => m.surface);
  if (withSurface.length > 0) {
    const surfaceOf = (m: PathMeta) => displaySurface(m.surface)!;
    const unique = [...new Set(withSurface.map(surfaceOf))];
    if (unique.length === 1) {
      facts.push({
        key: 'surface', value: unique[0],
        consistency: withSurface.length === members.length ? 'unanimous' : 'partial',
      });
    } else {
      const breakdown = unique.map(v => {
        const matching = withSurface.filter(m => surfaceOf(m) === v);
        const km = matching.reduce((s, m) => s + (m.length_km ?? 0), 0);
        return { value: v, count: matching.length, km: Math.round(km * 10) / 10 };
      });
      breakdown.sort((a, b) => (b.km || b.count) - (a.km || a.count));
      facts.push({ key: 'surface_mixed', consistency: 'mixed', breakdown });
    }
  }

  // --- Separated from cars ---
  const cycleways = members.filter(m => isSeparatedFromCars(m)).length;
  const nonCycleways = members.filter(m => m.highway && !isSeparatedFromCars(m)).length;
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
  if (factKey === 'parallel_to') return 'paths.label.alongside';
  if (factKey === 'some_parallel' || factKey === 'all_parallel') return 'paths.label.alongside';
  if (factKey === 'lit' || factKey === 'not_lit' || factKey === 'lit_mixed') return 'paths.label.lit';
  if (factKey === 'flat' || factKey === 'gentle_hills' || factKey === 'hilly') return 'paths.label.terrain';
  if (factKey === 'operator') return 'paths.label.operator';
  if (factKey.startsWith('network_')) return 'paths.label.network';
  if (factKey === 'seasonal') return 'paths.label.seasonal';
  if (factKey === 'access_private' || factKey === 'access_permissive') return 'paths.label.access';
  if (factKey === 'ref') return 'paths.label.ref';
  if (factKey === 'inception') return 'paths.label.established';
  if (factKey === 'overlapping_relation') return 'paths.label.also_part_of';
  return `paths.label.${factKey}`;
}

/** Localize a fact's value for table display. */
export function localizeFactValue(fact: PathFact, t: Translator, locale?: string): string {
  switch (fact.key) {
    case 'path_info': {
      // Value format: "path_type::width" — parse and localize each part
      const [pt, , width] = (fact.value || '').split(':');
      const parts: string[] = [];
      if (pt) {
        const ptKey = `paths.fact.${pt.replace(/-/g, '_')}`;
        const ptTranslated = t(ptKey, locale);
        parts.push(ptTranslated !== ptKey ? ptTranslated : pt);
      }
      if (width) parts.push(`${width}m ${t('paths.fact.wide', locale)}`);
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
    case 'surface': {
      const surfLabel = localizeSurface(fact.value, t, locale) || fact.value || '';
      // Smoothness as adjective: EN "Smooth pavement", FR "Asphalté lisse"
      const adj = fact.breakdown?.[0]?.value;
      if (adj) {
        const adjKey = `paths.fact.surface_adj_${adj}`;
        const adjLabel = t(adjKey, locale);
        if (adjLabel === adjKey) return surfLabel;
        // Template handles word order: EN "{adj} {surface}", FR "{surface} {adj}"
        const tmpl = t('paths.fact.surface_condition', locale);
        return tmpl !== 'paths.fact.surface_condition'
          ? tmpl.replace('{adj}', adjLabel).replace('{surface}', surfLabel.toLowerCase())
          : `${adjLabel} ${surfLabel.toLowerCase()}`;
      }
      return surfLabel;
    }
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
      return localizeSeasonal(fact.value || '', t, locale);
    case 'access_private':
      return t('paths.fact.access_private', locale);
    case 'access_permissive':
      return t('paths.fact.access_permissive', locale);
    case 'ref':
    case 'inception':
      return fact.value || '';
    case 'gentle_hills':
      return fact.value
        ? t('paths.fact.gentle_hills', locale, { meters: fact.value })
        : t('paths.fact.gentle_hills_no_meters', locale);
    case 'hilly':
      return fact.value
        ? t('paths.fact.hilly', locale, { meters: fact.value })
        : t('paths.fact.hilly_no_meters', locale);
    case 'surface_mixed': {
      if (!fact.breakdown) return '';
      return fact.breakdown
        .map(b => {
          const label = localizeSurface(b.value, t, locale) || b.value;
          return b.km ? `${label} (${Math.round(b.km)} km)` : label;
        })
        .filter(s => !s.includes('(0 km)'))
        .join(', ');
    }
    case 'lit_mixed':
      return t('paths.fact.partially_lit', locale);
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
  // Mixed path type: "Mountain bike trail (142 km), Multi-use pathway (8 km)"
  if (fact.key === 'path_type_mixed' && fact.breakdown) {
    return fact.breakdown
      .filter(b => !b.km || Math.round(b.km) > 0)
      .map(b => {
        const i18nKey = `paths.fact.${b.value.replace(/-/g, '_')}`;
        const translated = t(i18nKey, locale);
        const label = translated !== i18nKey ? translated : b.value;
        return b.km ? `${label} (${Math.round(b.km)} km)` : `${label} (${b.count})`;
      })
      .join(', ');
  }

  // Mixed surface: "Gravel (142 km), Paved (8 km)"
  if (fact.key === 'surface_mixed' && fact.breakdown) {
    return fact.breakdown
      .filter(b => !b.km || Math.round(b.km) > 0)
      .map(b => {
        const label = localizeSurface(b.value, t, locale) || b.value;
        return b.km ? `${label} (${Math.round(b.km)} km)` : `${label} (${b.count})`;
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

const ALL_SEASONS = ['spring', 'summer', 'autumn', 'winter'] as const;

/**
 * Localize a seasonal value by describing the complement when shorter.
 * "spring;summer;autumn" → "Closed in winter" (1 missing beats listing 3 present).
 */
function localizeSeasonal(value: string, t: Translator, locale?: string): string {
  if (value === 'yes') return t('paths.fact.seasonal_yes', locale);

  const present = value.split(';').map(s => s.trim()).filter(s => (ALL_SEASONS as readonly string[]).includes(s));

  if (present.length === 0) {
    // Not parseable as season list — try direct key (e.g. seasonal_winter)
    const key = `paths.fact.seasonal_${value}`;
    const translated = t(key, locale);
    return translated !== key ? translated : value;
  }

  if (present.length >= 4) return t('paths.fact.seasonal_yes', locale);

  const missing = ALL_SEASONS.filter(s => !present.includes(s));
  const seasonName = (s: string) => t(`paths.fact.season_${s}`, locale);

  // 1 open season → "Winter only" (prefer direct key for backwards compat)
  if (present.length === 1) {
    const directKey = `paths.fact.seasonal_${present[0]}`;
    const direct = t(directKey, locale);
    if (direct !== directKey) return direct;
    return t('paths.fact.seasonal_only', locale, { season: seasonName(present[0]) });
  }

  // 2–3 open seasons → describe by what's closed
  return t('paths.fact.seasonal_closed', locale, { seasons: missing.map(seasonName).join(', ') });
}

/** Localize a raw OSM surface value (e.g. "fine_gravel" → "Gravel"). */
export function localizeSurface(raw: string | undefined, t: Translator, locale?: string): string | undefined {
  const cat = displaySurface(raw);
  if (!cat) return undefined;
  const i18nKey = `paths.fact.${cat}`;
  const translated = t(i18nKey, locale);
  return translated !== i18nKey ? translated : cat;
}

/** Localize a path_type value (e.g. 'mtb-trail' → 'Mountain bike trail'). */
export function localizePathType(pt: string | undefined, t: Translator, locale?: string): string | undefined {
  if (!pt) return undefined;
  const key = `paths.fact.${pt.replace(/-/g, '_')}`;
  const val = t(key, locale);
  return val !== key ? val : undefined;
}

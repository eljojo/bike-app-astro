// scripts/pipeline/lib/osm-tags.ts
//
// Pure functions for OSM tag extraction, merging, and entry enrichment.
// No state, no I/O. Used by discover.ts and assemble.ts.

/** A loose bag of OSM tags — keys are strings, values can be anything. */
type Tags = Record<string, any>;

/** A way element with optional tags and geometry from Overpass. */
interface WayElement {
  id?: number;
  tags?: Tags;
  name?: string;
  geometry?: Array<[number, number] | { lon: number; lat: number }>;
}

/** Meaningful cycleway tag values — the ones that indicate cycling
 *  infrastructure. Excludes `crossing`, `no`, `opposite`, etc. */
const MEANINGFUL_CYCLEWAY_VALUES = new Set(['lane', 'track', 'separated', 'shoulder', 'shared_lane']);

/** Pick the "best" cycleway value from a way's tag set, merging the
 *  directional variants. Precedence: direct `cycleway` > `cycleway:both` >
 *  `cycleway:right` > `cycleway:left`. Returns undefined if no meaningful
 *  cycleway value is present on any of the four fields. */
function pickMeaningfulCycleway(tags: Tags): string | undefined {
  const candidates = [tags.cycleway, tags['cycleway:both'], tags['cycleway:right'], tags['cycleway:left']];
  for (const v of candidates) {
    if (typeof v === 'string' && MEANINGFUL_CYCLEWAY_VALUES.has(v)) return v;
  }
  return undefined;
}

/**
 * Extract useful OSM tags into structured metadata for bikepaths.yml.
 * Only includes fields that have values — no nulls or empty strings.
 */
export function extractOsmMetadata(tags: Tags | null | undefined): Tags {
  if (!tags) return {};
  const meta: Tags = {};

  // Bilingual names
  if (tags['name:fr']) meta.name_fr = tags['name:fr'];
  if (tags['name:en']) meta.name_en = tags['name:en'];
  if (tags.alt_name) meta.alt_name = tags.alt_name;

  // External references
  if (tags.wikipedia) meta.wikipedia = tags.wikipedia;
  if (tags.wikidata) meta.wikidata = tags.wikidata;
  if (tags.wikimedia_commons) meta.wikimedia_commons = tags.wikimedia_commons;
  if (tags.website || tags['contact:website']) meta.website = tags.website || tags['contact:website'];

  // Physical characteristics
  if (tags.surface) meta.surface = tags.surface;
  if (tags.smoothness) meta.smoothness = tags.smoothness;
  if (tags.width) {
    const w = parseFloat(tags.width);
    if (isNaN(w)) {
      console.warn(`  ⚠ width "${tags.width}" unparseable — ${tags.name || 'unnamed'}`);
    } else if (w < 0.3) {
      console.warn(`  ⚠ width ${w}m suspiciously narrow — ${tags.name || 'unnamed'}`);
    } else if (w > 6) {
      console.warn(`  ⚠ width ${w}m likely road width, not bike lane — ${tags.name || 'unnamed'}`);
    }
    meta.width = tags.width;
  }
  if (tags.lit) meta.lit = tags.lit;
  if (tags.incline) meta.incline = tags.incline;

  // Cycling infrastructure type. Collapse directional cycleway variants
  // (cycleway:right, cycleway:left, cycleway:both) into a single effective
  // cycleway value so downstream classification sees lane/track/shoulder on
  // roads that declare bike infrastructure on only one side. Precedence:
  // direct `cycleway` > `cycleway:both` > `cycleway:right` > `cycleway:left`.
  // Meaningful values only (lane, track, separated, shoulder) — ignore
  // `crossing`, `no`, or absent tags.
  if (tags.segregated) meta.segregated = tags.segregated;
  const effectiveCycleway = pickMeaningfulCycleway(tags);
  if (effectiveCycleway) meta.cycleway = effectiveCycleway;
  if (tags.highway) meta.highway = tags.highway;
  if (tags.tracktype) meta.tracktype = tags.tracktype;
  if (tags['mtb:scale'] != null) meta['mtb:scale'] = tags['mtb:scale'];
  if (tags['mtb:scale:imba'] != null) meta['mtb:scale:imba'] = tags['mtb:scale:imba'];
  if (tags.bicycle) meta.bicycle = tags.bicycle;

  // Network and management
  if (tags.operator) meta.operator = tags.operator;
  if (tags.network) meta.network = tags.network;
  if (tags.ref) meta.ref = tags.ref;
  if (tags.cycle_network) meta.cycle_network = tags.cycle_network;

  // Route info (relations)
  if (tags.distance) meta.distance = tags.distance;
  if (tags.description) meta.description = tags.description;

  // Seasonal / access
  if (tags.opening_hours) meta.opening_hours = tags.opening_hours;
  if (tags.seasonal) meta.seasonal = tags.seasonal;
  if (tags.access) meta.access = tags.access;

  // Pedestrian access and facility type (for facts engine)
  if (tags.foot) meta.foot = tags.foot;
  if (tags.sport) meta.sport = tags.sport;

  // Ski/piste signals — transient (stripped from YAML via writeYaml).
  // Consumed by deriveEntryType as a belt-and-suspenders check. The primary
  // defence against ski-only entries is the discover.ts ingestion filter.
  if (tags['piste:type']) meta._piste_type = tags['piste:type'];
  if (tags['piste:name']) meta._piste_name = tags['piste:name'];

  // Pipeline-computed distributions (from mergeWayTags)
  if (tags.surface_mix) meta.surface_mix = tags.surface_mix;
  if (tags.lit_mix) meta.lit_mix = tags.lit_mix;

  return meta;
}

/**
 * Per-segment characterization tags: these describe the nature of a specific
 * way, not the entry as a whole. If they only cover a minority of the entry's
 * length, propagating them up is misleading (a 1km ski-groomed segment inside
 * a 10km path does not make the whole path a ski trail; a single tunneled
 * segment does not make the whole corridor a tunnel).
 *
 * For these keys, a value must cover at least `MAJORITY_KM_THRESHOLD` of the
 * entry's total length to be propagated to the merged entry tags. Minority
 * values are dropped. See `_ctx/tag-propagation.md`.
 */
const PER_SEGMENT_TAGS = new Set([
  // Ski/piste — per-segment grooming metadata
  'piste:type', 'piste:name', 'piste:difficulty', 'piste:grooming', 'piste:ref',
  'ski', 'snowmobile', 'horse',
  // Structures — a single tunneled/bridged segment doesn't describe the whole
  'tunnel', 'bridge', 'ford', 'embankment', 'cutting',
  // Rail heritage — per-segment fact, not entry-wide identity
  'railway', 'abandoned:railway',
]);
const MAJORITY_KM_THRESHOLD = 0.5;

/**
 * For named ways grouped by name, pick the most common value for each tag
 * across all ways in the group.
 *
 * Most tags are merged by km-weighted majority: the value with the most
 * distance wins. Per-segment characterization tags (`PER_SEGMENT_TAGS`) are
 * held to a stricter standard: the winning value must cover at least half of
 * the entry's total length, otherwise the tag is dropped. This prevents
 * minority segment characteristics from bleeding up to the entry level.
 */
export function mergeWayTags(ways: WayElement[]): Tags {
  // Weight each tag value by way length (km) instead of way count
  const tagKm: Record<string, Record<string, number>> = {};
  let entryTotalKm = 0;
  for (const way of ways) {
    const tags = way.tags || {};
    const km = wayLengthKm(way);
    entryTotalKm += km;
    for (const [key, val] of Object.entries(tags)) {
      if (!tagKm[key]) tagKm[key] = {};
      tagKm[key][val] = (tagKm[key][val] || 0) + km;
    }
  }
  // Pick the value with the most distance for each tag
  const merged: Tags = {};
  const losses: string[] = [];
  const minorityDrops: string[] = [];
  for (const [key, vals] of Object.entries(tagKm)) {
    let bestVal: string | null = null, bestKm = 0, totalKm = 0;
    for (const [val, km] of Object.entries(vals)) {
      totalKm += km;
      if (km > bestKm) { bestKm = km; bestVal = val; }
    }
    // Per-segment tags must cover a majority of the ENTRY length (not just
    // the ways that happen to have the tag). This keeps a minority segment
    // feature from becoming an entry-level fact.
    if (PER_SEGMENT_TAGS.has(key) && entryTotalKm > 0 && bestKm / entryTotalKm < MAJORITY_KM_THRESHOLD) {
      const pct = Math.round((bestKm / entryTotalKm) * 100);
      minorityDrops.push(`${key}="${bestVal}" (${pct}% of entry)`);
      continue;
    }
    merged[key] = bestVal;
    // Flag when >30% of distance disagrees on a physical tag
    const PHYSICAL_TAGS = ['surface', 'width', 'lit', 'smoothness', 'incline', 'segregated'];
    if (PHYSICAL_TAGS.includes(key) && Object.keys(vals).length > 1 && bestKm / totalKm < 0.7) {
      const alternatives = Object.entries(vals).filter(([v]) => v !== bestVal).map(([v, km]) => `${v}(${km.toFixed(1)}km)`).join(', ');
      losses.push(`${key}: picked "${bestVal}"(${bestKm.toFixed(1)}/${totalKm.toFixed(1)}km), lost ${alternatives}`);
    }
  }
  if (losses.length > 0) {
    const name = ways[0]?.tags?.name || ways[0]?.name || '?';
    console.log(`  [tag-merge] ${name}: ${losses.join('; ')}`);
  }
  if (minorityDrops.length > 0) {
    const name = ways[0]?.tags?.name || ways[0]?.name || '?';
    console.log(`  [tag-merge] ${name}: dropped minority ${minorityDrops.join('; ')}`);
  }

  // --- Compute distributions for surface and lit (reuse tagKm) ---
  const MIX_TAGS = ['surface', 'lit'];
  for (const tag of MIX_TAGS) {
    const vals = tagKm[tag];
    if (!vals || Object.keys(vals).length <= 1) continue;
    // For lit: only produce lit_mix when both 'yes' and 'no' are present
    if (tag === 'lit' && !(vals['yes'] && vals['no'])) continue;

    const mix = Object.entries(vals)
      .map(([value, km]) => ({ value, km: Math.round(km) }))
      .filter(m => m.km > 0)
      .sort((a, b) => b.km - a.km);

    if (mix.length > 1) {
      merged[`${tag}_mix`] = mix;
    }
  }

  return merged;
}

/** Compute length of a way in km from its geometry. Falls back to 1 if no geometry.
 * Accepts geometry nodes as [lon, lat] arrays or {lon, lat} objects. */
export function wayLengthKm(way: WayElement): number {
  const geom = way.geometry;
  if (!geom || geom.length < 2) return 1; // fallback: 1 km per way
  let totalM = 0;
  for (let i = 1; i < geom.length; i++) {
    const p1 = geom[i - 1];
    const p2 = geom[i];
    const lon1 = Array.isArray(p1) ? p1[0] : p1.lon;
    const lat1 = Array.isArray(p1) ? p1[1] : p1.lat;
    const lon2 = Array.isArray(p2) ? p2[0] : p2.lon;
    const lat2 = Array.isArray(p2) ? p2[1] : p2.lat;
    const dlat = (lat2 - lat1) * 111320;
    const dlng = (lon2 - lon1) * 111320 * Math.cos(((lat1 + lat2) / 2) * Math.PI / 180);
    totalM += Math.sqrt(dlat * dlat + dlng * dlng);
  }
  return totalM / 1000;
}

// Identity tags describe the entity (route, bridge, road) — not physical
// infrastructure. When merging way tags into a relation entry, these must
// be skipped because a way's identity (e.g. Adàwe Crossing bridge) is not
// the route's identity (Crosstown Bikeway 3).
export const IDENTITY_TAGS = new Set([
  'name_fr', 'name_en', 'alt_name',
  'wikidata', 'wikipedia', 'wikimedia_commons',
  'operator', 'network', 'ref', 'cycle_network',
  'distance', 'description',
]);

/**
 * Enrich an entry with OSM metadata, only adding fields it doesn't
 * already have (hand-edited values take precedence).
 *
 * @param entry — the entry to enrich
 * @param tags — OSM tags to merge in
 * @param opts
 * @param opts.skipIdentity — if true, skip identity tags
 *   (use when merging way-level tags into a relation entry)
 */
export function enrichEntry(entry: Tags, tags: Tags, { skipIdentity = false } = {}): void {
  const meta = extractOsmMetadata(tags);
  for (const [key, val] of Object.entries(meta)) {
    if (entry[key] == null) {
      if (skipIdentity && IDENTITY_TAGS.has(key)) continue;
      entry[key] = val;
    }
  }
}

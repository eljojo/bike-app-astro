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

  // Cycling infrastructure type
  if (tags.segregated) meta.segregated = tags.segregated;
  if (tags.cycleway) meta.cycleway = tags.cycleway;
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

  // Pipeline-computed distributions (from mergeWayTags)
  if (tags.surface_mix) meta.surface_mix = tags.surface_mix;
  if (tags.lit_mix) meta.lit_mix = tags.lit_mix;

  return meta;
}

/**
 * For named ways grouped by name, pick the most common value for each tag
 * across all ways in the group.
 */
export function mergeWayTags(ways: WayElement[]): Tags {
  const tagCounts: Record<string, Record<string, number>> = {};
  for (const way of ways) {
    const tags = way.tags || {};
    for (const [key, val] of Object.entries(tags)) {
      if (!tagCounts[key]) tagCounts[key] = {};
      tagCounts[key][val] = (tagCounts[key][val] || 0) + 1;
    }
  }
  // Pick the most common value for each tag
  const merged: Tags = {};
  const losses: string[] = [];
  for (const [key, vals] of Object.entries(tagCounts)) {
    let bestVal: string | null = null, bestCount = 0, totalCount = 0;
    for (const [val, count] of Object.entries(vals)) {
      totalCount += count;
      if (count > bestCount) { bestCount = count; bestVal = val; }
    }
    merged[key] = bestVal;
    // Flag when >30% of ways disagree on a physical tag
    const PHYSICAL_TAGS = ['surface', 'width', 'lit', 'smoothness', 'incline', 'segregated'];
    if (PHYSICAL_TAGS.includes(key) && totalCount > 2 && bestCount / totalCount < 0.7) {
      const alternatives = Object.entries(vals).filter(([v]) => v !== bestVal).map(([v, c]) => `${v}(${c})`).join(', ');
      losses.push(`${key}: picked "${bestVal}"(${bestCount}/${totalCount}), lost ${alternatives}`);
    }
  }
  if (losses.length > 0) {
    const name = ways[0]?.tags?.name || ways[0]?.name || '?';
    console.log(`  [tag-merge] ${name}: ${losses.join('; ')}`);
  }

  // --- Compute distributions for surface and lit ---
  const MIX_TAGS = ['surface', 'lit'];
  for (const tag of MIX_TAGS) {
    const vals = tagCounts[tag];
    if (!vals || Object.keys(vals).length <= 1) continue;
    // For lit: only produce lit_mix when both 'yes' and 'no' are present
    if (tag === 'lit' && !(vals['yes'] && vals['no'])) continue;

    // Compute length per value
    const valueLengths: Record<string, number> = {};
    for (const way of ways) {
      const val = (way.tags || {} as Tags)[tag];
      if (!val) continue;
      const km = wayLengthKm(way);
      valueLengths[val] = (valueLengths[val] || 0) + km;
    }

    const mix = Object.entries(valueLengths)
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

import { z } from 'zod/v4';
import yaml from 'js-yaml';

/** A single entry from bikepaths.yml */
export const bikePathYmlEntrySchema = z.looseObject({
  name: z.string(),
  /** Stored slug from the pipeline — eliminates runtime slug derivation. */
  slug: z.string().optional(),
  name_en: z.string().optional(),
  name_fr: z.string().optional(),
  osm_relations: z.array(z.number()).optional(),
  osm_names: z.array(z.string()).optional(),
  anchors: z.array(z.union([
    z.object({ lat: z.number(), lng: z.number() }),
    z.tuple([z.number(), z.number()]), // [lng, lat] — GeoJSON coordinate order
  ])).optional(),
  surface: z.string().optional(),
  smoothness: z.string().optional(),
  width: z.string().optional(),
  lit: z.string().optional(),
  segregated: z.string().optional(),
  highway: z.string().optional(),
  network: z.string().optional(),
  operator: z.string().optional(),
  website: z.string().optional(),
  wikidata: z.string().optional(),
  wikipedia: z.string().optional(),
  seasonal: z.string().optional(),
  description: z.string().optional(),
  cycleway: z.string().optional(),
  ref: z.string().optional(),
  parallel_to: z.string().optional(),
  segments: z.array(z.looseObject({ osm_way: z.number() })).optional(),
  /** Entry classification from the pipeline (see entry-type.mjs / _ctx/entry-types.md).
   * trail: long-distance named route people plan trips for (PPJ, Route Verte, TCT). May have members (sections).
   * network: interconnected city-level system (Capital Pathway, NCC Greenbelt). Has members.
   * destination: local path with real-world identity (Sawmill Creek, park trail).
   * infrastructure: bike lane or short named path, visible on map, no page.
   * connector: tiny segment under 300m, invisible. */
  type: z.enum(['trail', 'network', 'destination', 'infrastructure', 'connector']).optional(),
  /** For networks: slugs of member paths. */
  members: z.array(z.string()).optional(),
  /** Slug of the network this path belongs to. */
  member_of: z.string().optional(),
  /** Mountain bike trail — set by detect-mtb.mjs in the data pipeline. */
  mtb: z.boolean().optional(),
  /** Infrastructure type — classifies the path by safety and bike requirements. */
  path_type: z.enum(['mup', 'separated-lane', 'bike-lane', 'paved-shoulder', 'mtb-trail', 'trail']).optional(),
  /** Super-network attribute (e.g., capital-pathway, trans-canada-trail).
   * Display-only — does NOT produce a page. Shows in facts table, influences index grouping. */
  super_network: z.string().optional(),
  /** OSM cycle_network tag (e.g., "National Capital Region"). */
  cycle_network: z.string().optional(),
  /** Metadata enriched from Wikidata. */
  wikidata_meta: z.object({
    description_en: z.string().optional(),
    description_fr: z.string().optional(),
    length_km: z.number().optional(),
    inception: z.string().optional(),
    website: z.string().optional(),
  }).optional(),
});

export type BikePathYmlEntry = z.infer<typeof bikePathYmlEntrySchema>;

export interface SluggedBikePathYml extends BikePathYmlEntry {
  slug: string;
}

/** Super-network metadata from the optional top-level super_networks section. */
export interface SuperNetworkMeta {
  name: string;
  slug: string;
  wikidata?: string;
  operator?: string;
  network?: string;
  wikidata_meta?: BikePathYmlEntry['wikidata_meta'];
}

/** Convert a bike path name to a URL-safe slug. */
export function slugifyBikePathName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')  // strip diacritics
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')     // strip special chars
    .trim()
    .replace(/[\s-]+/g, '-')          // spaces/hyphens to single hyphen
    .replace(/^-+|-+$/g, '');         // trim leading/trailing hyphens
}

/** Sort key for deterministic ordering of entries with the same slug. */
function slugSortKey(entry: BikePathYmlEntry): string {
  // Prefer first OSM relation ID, then first anchor coordinate, then name
  if (entry.osm_relations?.length) return `r${entry.osm_relations[0]}`;
  if (entry.anchors?.length) {
    const a = entry.anchors[0];
    const [x, y] = Array.isArray(a) ? a : [a.lng, a.lat];
    return `a${x.toFixed(6)},${y.toFixed(6)}`;
  }
  return `n${entry.name}`;
}

/** Parse bikepaths.yml content and return entries with stable slugs + optional super-network metadata. */
export function parseBikePathsYml(content: string): { entries: SluggedBikePathYml[]; superNetworks: SuperNetworkMeta[] } {
  const raw = yaml.load(content) as { bike_paths?: unknown[]; super_networks?: Array<Record<string, unknown>> };
  if (!raw || !Array.isArray(raw.bike_paths)) {
    throw new Error('bikepaths.yml must have a top-level bike_paths array');
  }

  // Parse optional super_networks section (Capital Pathway, TCT, etc.)
  const superNetworks: SuperNetworkMeta[] = (raw.super_networks ?? []).map(sn => ({
    name: String(sn.name || ''),
    slug: String(sn.slug || slugifyBikePathName(String(sn.name || ''))),
    wikidata: sn.wikidata as string | undefined,
    operator: sn.operator as string | undefined,
    network: sn.network as string | undefined,
    wikidata_meta: sn.wikidata_meta as SuperNetworkMeta['wikidata_meta'],
  }));
  const entries = raw.bike_paths.map(e => bikePathYmlEntrySchema.parse(e));

  // Use stored slugs if present (pipeline writes them). Fall back to
  // runtime computation for entries without stored slugs (old data).
  const hasStoredSlugs = entries.some(e => e.slug);

  let result: Array<{ slug: string; index: number; entry: BikePathYmlEntry }>;
  if (hasStoredSlugs) {
    // Prefer stored slugs. Entries without a stored slug get computed.
    const usedSlugs = new Set<string>();
    result = entries.map((entry, index) => {
      if (entry.slug) {
        usedSlugs.add(entry.slug);
        return { slug: entry.slug, index, entry };
      }
      // Fallback: compute slug for entries missing one
      let slug = slugifyBikePathName(entry.name);
      let suffix = 1;
      while (usedSlugs.has(slug)) slug = `${slugifyBikePathName(entry.name)}-${suffix++}`;
      usedSlugs.add(slug);
      return { slug, index, entry };
    });
  } else {
    // Legacy path: no stored slugs, compute all
    const baseSlugMap = new Map<string, Array<{ entry: BikePathYmlEntry; index: number }>>();
    for (let i = 0; i < entries.length; i++) {
      const base = slugifyBikePathName(entries[i].name);
      const list = baseSlugMap.get(base);
      if (list) list.push({ entry: entries[i], index: i });
      else baseSlugMap.set(base, [{ entry: entries[i], index: i }]);
    }
    result = [];
    for (const [base, group] of baseSlugMap) {
      group.sort((a, b) => slugSortKey(a.entry).localeCompare(slugSortKey(b.entry)));
      for (let i = 0; i < group.length; i++) {
        const slug = group.length === 1 ? base : `${base}-${i + 1}`;
        result.push({ slug, index: group[i].index, entry: group[i].entry });
      }
    }
  }

  // Restore original order so downstream code sees entries in YAML order
  result.sort((a, b) => a.index - b.index);
  return { entries: result.map(r => ({ ...r.entry, slug: r.slug })), superNetworks };
}

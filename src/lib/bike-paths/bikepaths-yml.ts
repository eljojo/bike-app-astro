import { z } from 'zod/v4';
import yaml from 'js-yaml';

/** A single entry from bikepaths.yml */
export const bikePathYmlEntrySchema = z.looseObject({
  name: z.string(),
  name_en: z.string().optional(),
  name_fr: z.string().optional(),
  osm_relations: z.array(z.number()).optional(),
  osm_names: z.array(z.string()).optional(),
  anchors: z.array(z.union([
    z.object({ lat: z.number(), lng: z.number() }),
    z.tuple([z.number(), z.number()]),
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
  segments: z.array(z.looseObject({ osm_way: z.number() })).optional(),
});

export type BikePathYmlEntry = z.infer<typeof bikePathYmlEntrySchema>;

export interface SluggedBikePathYml extends BikePathYmlEntry {
  slug: string;
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

/** Parse bikepaths.yml content and return entries with stable slugs. */
export function parseBikePathsYml(content: string): SluggedBikePathYml[] {
  const raw = yaml.load(content) as { bike_paths?: unknown[] };
  if (!raw || !Array.isArray(raw.bike_paths)) {
    throw new Error('bikepaths.yml must have a top-level bike_paths array');
  }
  const entries = raw.bike_paths.map(e => bikePathYmlEntrySchema.parse(e));

  // Group entries by base slug, sort each group deterministically, then number
  const baseSlugMap = new Map<string, Array<{ entry: BikePathYmlEntry; index: number }>>();
  for (let i = 0; i < entries.length; i++) {
    const base = slugifyBikePathName(entries[i].name);
    const list = baseSlugMap.get(base);
    if (list) list.push({ entry: entries[i], index: i });
    else baseSlugMap.set(base, [{ entry: entries[i], index: i }]);
  }

  const result: Array<{ slug: string; index: number; entry: BikePathYmlEntry }> = [];
  for (const [base, group] of baseSlugMap) {
    // Sort group deterministically by OSM relation ID / anchor / name
    group.sort((a, b) => slugSortKey(a.entry).localeCompare(slugSortKey(b.entry)));
    for (let i = 0; i < group.length; i++) {
      const slug = group.length === 1 ? base : `${base}-${i + 1}`;
      result.push({ slug, index: group[i].index, entry: group[i].entry });
    }
  }

  // Restore original order so downstream code sees entries in YAML order
  result.sort((a, b) => a.index - b.index);
  return result.map(r => ({ ...r.entry, slug: r.slug }));
}

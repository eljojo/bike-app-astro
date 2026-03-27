import { z } from 'astro/zod';
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
  seasonal: z.string().optional(),
  description: z.string().optional(),
  cycleway: z.string().optional(),
  ref: z.string().optional(),
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

/** Parse bikepaths.yml content and return entries with stable slugs. */
export function parseBikePathsYml(content: string): SluggedBikePathYml[] {
  const raw = yaml.load(content) as { bike_paths: unknown[] };
  const entries = raw.bike_paths.map(e => bikePathYmlEntrySchema.parse(e));

  const slugCounts = new Map<string, number>();
  return entries.map(entry => {
    let slug = slugifyBikePathName(entry.name);
    const count = (slugCounts.get(slug) ?? 0) + 1;
    slugCounts.set(slug, count);
    if (count > 1) slug = `${slug}-${count}`;
    return { ...entry, slug };
  });
}

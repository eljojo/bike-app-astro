import { getCollection } from 'astro:content';
import fs from 'node:fs';
import path from 'node:path';
import { cityDir } from '../config/config.server';
import { parseBikePathsYml, type SluggedBikePathYml } from './bikepaths-yml';
import { scoreBikePath, isHardExcluded, SCORE_THRESHOLD } from './bike-path-scoring';
import { haversineM } from '../geo/proximity';
import type { GpxPoint } from '../gpx/parse';

/** A bike path page to be generated — merged YML + markdown data. */
export interface BikePathPage {
  slug: string;
  name: string;
  name_fr?: string;
  vibe?: string;
  body?: string;
  photo_key?: string;
  tags: string[];
  score: number;
  hasMarkdown: boolean;
  ymlEntries: SluggedBikePathYml[];
  osmRelationIds: number[];
  osmNames: string[];
  surface?: string;
  width?: string;
  lit?: string;
  operator?: string;
  network?: string;
  highway?: string;
}

const NCC_NORMALIZE = /\b(ncc|ccn|national capital commission|commission de la capitale nationale)\b/i;

/** Normalize operator names — OSM has many variants for the same org. */
export function normalizeOperator(operator: string | undefined): string | undefined {
  if (!operator) return undefined;
  if (NCC_NORMALIZE.test(operator)) return 'NCC';
  return operator;
}

/** Load all bike path data, merge YML + markdown, score, and return pages to generate. */
export async function loadBikePathData(): Promise<{
  pages: BikePathPage[];
  allYmlEntries: SluggedBikePathYml[];
  geoFiles: string[];
}> {
  // 1. Parse bikepaths.yml (gracefully handle cities without bike paths)
  const ymlPath = path.join(cityDir, 'bikepaths.yml');
  const allYmlEntries = fs.existsSync(ymlPath)
    ? parseBikePathsYml(fs.readFileSync(ymlPath, 'utf-8'))
    : [];

  // 2. Load markdown files
  const markdownEntries = await getCollection('bike-paths');

  // 3. Build a map of YML slug -> entry for lookups
  const ymlBySlug = new Map<string, SluggedBikePathYml>();
  for (const entry of allYmlEntries) {
    ymlBySlug.set(entry.slug, entry);
  }

  // 4. Track which YML slugs are claimed by markdown `includes`
  const claimedSlugs = new Set<string>();
  const pages: BikePathPage[] = [];

  // 5. Process markdown files first (they have priority)
  for (const md of markdownEntries) {
    if (md.data.hidden) continue;

    const includes = md.data.includes ?? [];
    const matchedEntries: SluggedBikePathYml[] = [];

    for (const inc of includes) {
      const entry = ymlBySlug.get(inc);
      if (entry) {
        matchedEntries.push(entry);
        claimedSlugs.add(inc);
      }
    }

    if (matchedEntries.length === 0) {
      const entry = ymlBySlug.get(md.id);
      if (entry) {
        matchedEntries.push(entry);
        claimedSlugs.add(md.id);
      }
    }

    const osmRelationIds = matchedEntries.flatMap(e => e.osm_relations ?? []);
    const osmNames = matchedEntries.flatMap(e => e.osm_names ?? []);
    const primary = matchedEntries[0];

    const bestChildScore = matchedEntries.reduce(
      (max, e) => Math.max(max, scoreBikePath(e, 0)),
      0,
    );

    pages.push({
      slug: md.id,
      name: md.data.name ?? primary?.name ?? md.id,
      name_fr: md.data.name_fr ?? primary?.name_fr,
      vibe: md.data.vibe,
      body: md.body,
      photo_key: md.data.photo_key,
      tags: md.data.tags ?? [],
      score: bestChildScore,
      hasMarkdown: true,
      ymlEntries: matchedEntries,
      osmRelationIds,
      osmNames,
      surface: primary?.surface,
      width: primary?.width,
      lit: primary?.lit,
      operator: normalizeOperator(primary?.operator),
      network: primary?.network,
      highway: primary?.highway,
    });
  }

  // 6. Process unclaimed YML entries that pass scoring
  for (const entry of allYmlEntries) {
    if (claimedSlugs.has(entry.slug)) continue;
    if (isHardExcluded(entry)) continue;

    const score = scoreBikePath(entry, 0);
    if (score < SCORE_THRESHOLD) continue;

    pages.push({
      slug: entry.slug,
      name: entry.name,
      name_fr: entry.name_fr,
      tags: [],
      score,
      hasMarkdown: false,
      ymlEntries: [entry],
      osmRelationIds: entry.osm_relations ?? [],
      osmNames: entry.osm_names ?? [],
      surface: entry.surface,
      width: entry.width,
      lit: entry.lit,
      operator: normalizeOperator(entry.operator),
      network: entry.network,
      highway: entry.highway,
    });
  }

  // Scan for cached GeoJSON files (dev only — build uses inlined list from plugin)
  const geoDir = path.resolve('public/paths/geo');
  const geoFiles = fs.existsSync(geoDir)
    ? fs.readdirSync(geoDir).filter(f => f.endsWith('.geojson'))
    : [];

  return { pages, allYmlEntries, geoFiles };
}

/** Check if a GPX track passes near any of a bike path's anchor points. */
export function routePassesNearPath(
  trackPoints: GpxPoint[],
  pathAnchors: { lat: number; lng: number }[],
  thresholdM: number = 100,
): boolean {
  for (const anchor of pathAnchors) {
    for (const tp of trackPoints) {
      if (haversineM(tp.lat, tp.lon, anchor.lat, anchor.lng) <= thresholdM) {
        return true;
      }
    }
  }
  return false;
}

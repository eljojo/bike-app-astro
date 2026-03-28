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
  stub: boolean;
  ymlEntries: SluggedBikePathYml[];
  osmRelationIds: number[];
  osmNames: string[];
  /** Geographic points for this path — from YML anchors or sampled GeoJSON geometry. */
  points: Array<{ lat: number; lng: number }>;
  /** Number of routes that overlap this path (precomputed at build config time). */
  routeCount: number;
  /** Precomputed route cards for routes that overlap this path. */
  overlappingRoutes: Array<{ slug: string; name: string; distance_km: number; coverKey?: string }>;
  /** Precomputed nearby places (within 300m). */
  nearbyPlaces: Array<{ name: string; category: string; lat: number; lng: number; distance_m: number }>;
  /** Precomputed nearby paths (within 2km). */
  nearbyPaths: Array<{ slug: string; name: string; surface?: string }>;
  /** Precomputed connected paths (endpoints within 200m). */
  connectedPaths: Array<{ slug: string; name: string; surface?: string }>;
  surface?: string;
  width?: string;
  lit?: string;
  segregated?: string;
  smoothness?: string;
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

const SAMPLE_INTERVAL = 10;

/** Get geographic points for a path entry: YML anchors, or sampled GeoJSON geometry as fallback. */
function getPathPoints(entry: SluggedBikePathYml): Array<{ lat: number; lng: number }> {
  const anchors = (entry.anchors ?? []).map(a =>
    Array.isArray(a) ? { lat: a[1] as number, lng: a[0] as number } : a as { lat: number; lng: number }
  );
  if (anchors.length > 0) return anchors;

  // Fall back to GeoJSON for relation-based paths
  const geoDir = path.resolve('public/paths/geo');
  const points: Array<{ lat: number; lng: number }> = [];
  for (const relId of entry.osm_relations ?? []) {
    const geoPath = path.join(geoDir, `${relId}.geojson`);
    if (!fs.existsSync(geoPath)) continue;
    try {
      const geojson = JSON.parse(fs.readFileSync(geoPath, 'utf-8'));
      for (const feature of geojson.features ?? []) {
        if (feature.geometry?.type === 'LineString') {
          const coords = feature.geometry.coordinates;
          for (let i = 0; i < coords.length; i += SAMPLE_INTERVAL) {
            points.push({ lat: coords[i][1], lng: coords[i][0] });
          }
          if (coords.length > 0) {
            const last = coords[coords.length - 1];
            points.push({ lat: last[1], lng: last[0] });
          }
        }
      }
    } catch { /* skip malformed */ }
  }
  return points;
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

    const points = matchedEntries.flatMap(e => getPathPoints(e));

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
      stub: md.data.stub ?? false,
      ymlEntries: matchedEntries,
      osmRelationIds,
      osmNames,
      points,
      routeCount: 0,
      overlappingRoutes: [],
      nearbyPlaces: [],
      nearbyPaths: [],
      connectedPaths: [],
      surface: primary?.surface,
      width: primary?.width,
      lit: primary?.lit,
      segregated: primary?.segregated,
      smoothness: primary?.smoothness,
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
      stub: false,
      ymlEntries: [entry],
      osmRelationIds: entry.osm_relations ?? [],
      osmNames: entry.osm_names ?? [],
      points: getPathPoints(entry),
      routeCount: 0,
      overlappingRoutes: [],
      nearbyPlaces: [],
      nearbyPaths: [],
      connectedPaths: [],
      surface: entry.surface,
      width: entry.width,
      lit: entry.lit,
      segregated: entry.segregated,
      smoothness: entry.smoothness,
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

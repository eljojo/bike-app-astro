/**
 * Canonical synchronous merge of bikepaths.yml + bike-paths/*.md + geometry.
 *
 * This file is NOT subject to the build-data-plugin transform. It reads data
 * directly from the filesystem and is available at Vite config time (before
 * getCollection is available). The build-data-plugin calls loadBikePathEntries()
 * to get the base data, then enriches it with route overlaps, photos, places, etc.
 */
import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { cityDir } from '../config/config.server';
import { parseBikePathsYml, type SluggedBikePathYml } from './bikepaths-yml.server';
import { sampleGeoJsonPoints, SAMPLE_INTERVAL } from '../geo/geojson-sampling';
import { scoreBikePath, isHardExcluded, SCORE_THRESHOLD } from './bike-path-scoring.server';
import { haversineM } from '../geo/proximity';
import { supportedLocales, defaultLocale } from '../i18n/locale-utils';
import { getCityConfig } from '../config/city-config';

// Resolve project root from this file's location (src/lib/bike-paths/) — avoids CWD dependency.
// Lazy: import.meta.dirname is undefined in workerd (Cloudflare prerender), but this code
// only runs at Vite config time (Node.js). The build-data-plugin replaces the consuming
// module so this file is only imported for re-exported functions like normalizeOperator.
let _projectRoot: string | undefined;
function getProjectRoot(): string {
  if (!_projectRoot) _projectRoot = path.resolve(import.meta.dirname, '..', '..', '..');
  return _projectRoot;
}

/** Locale-specific content overrides for a bike path. */
export interface BikePathTranslation {
  slug?: string;
  name?: string;
  vibe?: string;
  body?: string;
}

/** Lightweight reference to a member path — used in network pages to avoid
 * embedding full BikePathPage objects in the virtual module bundle. */
export interface MemberRef {
  slug: string;
  name: string;
  length_km?: number;
  thumbnail_key?: string;
  standalone: boolean;
}

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
  /** Whether this path appears in the /paths directory listing. */
  listed: boolean;
  /** Whether this path gets its own standalone page (single source of truth).
   * Every consumer (sitemap, map popups, nearby paths) checks this. */
  standalone: boolean;
  stub: boolean;
  featured: boolean;
  /** Slug of the primary network this path belongs to, if any. */
  memberOf?: string;
  /** For network pages: lightweight refs to member paths. */
  memberRefs?: MemberRef[];
  ymlEntries: SluggedBikePathYml[];
  osmRelationIds: number[];
  osmNames: string[];
  /** GeoJSON filenames for this path (e.g., "12345.geojson", "name-foo.geojson"). */
  geoFiles: string[];
  /** Geographic points for this path — from YML anchors or sampled GeoJSON geometry. */
  points: Array<{ lat: number; lng: number }>;
  /** Number of routes that overlap this path (precomputed at build config time). */
  routeCount: number;
  /** Precomputed route cards for routes that overlap this path. */
  overlappingRoutes: Array<{ slug: string; name: string; distance_km: number; coverKey?: string }>;
  /** Geolocated photos taken near this path. */
  nearbyPhotos: Array<{ key: string; lat: number; lng: number; routeSlug: string; caption?: string }>;
  /** Precomputed nearby places (within 300m). */
  nearbyPlaces: Array<{ name: string; category: string; lat: number; lng: number; distance_m: number }>;
  /** Precomputed nearby paths (within 2km). */
  nearbyPaths: Array<{ slug: string; name: string; surface?: string }>;
  /** Precomputed connected paths (endpoints within 200m). */
  connectedPaths: Array<{ slug: string; name: string; surface?: string }>;
  /** Wikipedia article reference — "en:Article Title" format. */
  wikipedia?: string;
  /** Resolved thumbnail key for index display (photo_key → route cover → map PNG). */
  thumbnail_key?: string;
  /** Total path length in km, computed from GeoJSON geometry. */
  length_km?: number;
  /** Elevation gain in meters (from enriched GeoJSON, if available). */
  elevation_gain_m?: number;
  surface?: string;
  width?: string;
  lit?: string;
  segregated?: string;
  smoothness?: string;
  operator?: string;
  network?: string;
  highway?: string;
  /** Road name this path runs alongside (for parallel bike lanes). */
  parallel_to?: string;
  /** Locale-specific content overrides from .{locale}.md files + YML name_fr. */
  translations: Record<string, BikePathTranslation>;
}

function buildOperatorAliases(): Array<{ pattern: RegExp; canonical: string }> {
  const config = getCityConfig();
  const aliases = (config as unknown as Record<string, unknown>).operator_aliases as Record<string, string[]> | undefined;
  if (!aliases) return [];
  return Object.entries(aliases).map(([canonical, variants]) => ({
    pattern: new RegExp(`\\b(${variants.join('|')})\\b`, 'i'),
    canonical,
  }));
}

/** Normalize operator names — OSM has many variants for the same org. */
export function normalizeOperator(operator: string | undefined): string | undefined {
  if (!operator) return undefined;
  for (const alias of buildOperatorAliases()) {
    if (alias.pattern.test(operator)) return alias.canonical;
  }
  return operator;
}

/** Read sampled points from a GeoJSON file. */
function readGeoPoints(filePath: string): Array<{ lat: number; lng: number }> {
  if (!fs.existsSync(filePath)) return [];
  try {
    const geojson = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return sampleGeoJsonPoints(geojson, SAMPLE_INTERVAL);
  } catch { return []; }
}

/** Compute total length (km) of all LineString/MultiLineString features in a GeoJSON file. */
function readGeoLengthKm(filePath: string): number {
  if (!fs.existsSync(filePath)) return 0;
  try {
    const geojson = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    let totalM = 0;
    for (const feature of geojson.features ?? []) {
      const geomType = feature.geometry?.type;
      const lineArrays: number[][][] =
        geomType === 'LineString' ? [feature.geometry.coordinates] :
        geomType === 'MultiLineString' ? feature.geometry.coordinates :
        [];
      for (const coords of lineArrays) {
        for (let i = 1; i < coords.length; i++) {
          totalM += haversineM(coords[i - 1][1], coords[i - 1][0], coords[i][1], coords[i][0]);
        }
      }
    }
    return totalM / 1000;
  } catch { return 0; }
}

/** Compute total length (km) for a path from all its GeoJSON files. */
function getPathLengthKm(entry: SluggedBikePathYml): number | undefined {
  const geoDir = path.join(getProjectRoot(), 'public', 'bike-paths', 'geo');
  let totalKm = 0;
  for (const relId of entry.osm_relations ?? []) {
    totalKm += readGeoLengthKm(path.join(geoDir, `${relId}.geojson`));
  }
  if (totalKm === 0 && entry.osm_names?.length) {
    totalKm = readGeoLengthKm(path.join(geoDir, `name-${entry.slug}.geojson`));
  }
  if (totalKm === 0 && entry.segments?.length) {
    totalKm = readGeoLengthKm(path.join(geoDir, `seg-${entry.slug}.geojson`));
  }
  if (totalKm === 0 && entry.parallel_to) {
    totalKm = readGeoLengthKm(path.join(geoDir, `parallel-${entry.slug}.geojson`));
  }
  return totalKm > 0 ? Math.round(totalKm * 10) / 10 : undefined;
}

/** Get geographic points for a path: GeoJSON geometry first, YML anchors as fallback. */
function getPathPoints(entry: SluggedBikePathYml): Array<{ lat: number; lng: number }> {
  const geoDir = path.join(getProjectRoot(), 'public', 'bike-paths', 'geo');
  const points: Array<{ lat: number; lng: number }> = [];

  for (const relId of entry.osm_relations ?? []) {
    points.push(...readGeoPoints(path.join(geoDir, `${relId}.geojson`)));
  }

  if (points.length === 0 && entry.osm_names?.length) {
    points.push(...readGeoPoints(path.join(geoDir, `name-${entry.slug}.geojson`)));
  }

  if (points.length === 0 && entry.segments?.length) {
    points.push(...readGeoPoints(path.join(geoDir, `seg-${entry.slug}.geojson`)));
  }

  if (points.length === 0 && entry.parallel_to) {
    points.push(...readGeoPoints(path.join(geoDir, `parallel-${entry.slug}.geojson`)));
  }

  if (points.length === 0) {
    const anchors = (entry.anchors ?? []).map(a =>
      Array.isArray(a) ? { lat: a[1] as number, lng: a[0] as number } : a as { lat: number; lng: number }
    );
    points.push(...anchors);
  }

  return points;
}

/** Compute the GeoJSON filenames that a set of YML entries would produce. */
function entryGeoFiles(entries: SluggedBikePathYml[]): string[] {
  const files: string[] = [];
  for (const e of entries) {
    if (e.osm_relations?.length) {
      for (const relId of e.osm_relations) files.push(`${relId}.geojson`);
    } else if (e.osm_names?.length) {
      files.push(`name-${e.slug}.geojson`);
    } else if (e.segments?.length) {
      files.push(`seg-${e.slug}.geojson`);
    } else if (e.parallel_to) {
      files.push(`parallel-${e.slug}.geojson`);
    }
  }
  return files;
}

/** Parsed markdown frontmatter for a bike-path .md file. */
interface MarkdownEntry {
  id: string;
  data: {
    name?: string;
    name_fr?: string;
    vibe?: string;
    hidden: boolean;
    stub: boolean;
    featured: boolean;
    includes: string[];
    photo_key?: string;
    tags: string[];
    wikipedia?: string;
    operator?: string;
  };
  body: string;
}

/** Read bike-path markdown files from the city's bike-paths/ directory. */
function readMarkdownEntries(): MarkdownEntry[] {
  const bikePathsDir = path.join(cityDir, 'bike-paths');
  if (!fs.existsSync(bikePathsDir)) return [];

  const entries: MarkdownEntry[] = [];
  for (const file of fs.readdirSync(bikePathsDir)) {
    if (!file.endsWith('.md')) continue;
    // Skip translation files like path.fr.md
    const parts = file.replace('.md', '').split('.');
    if (parts.length > 1) continue;

    const id = file.replace('.md', '');
    const raw = fs.readFileSync(path.join(bikePathsDir, file), 'utf-8');
    const { data: fm, content: body } = matter(raw);

    entries.push({
      id,
      data: {
        name: fm.name as string | undefined,
        name_fr: fm.name_fr as string | undefined,
        vibe: fm.vibe as string | undefined,
        hidden: (fm.hidden as boolean) || false,
        stub: (fm.stub as boolean) || false,
        featured: (fm.featured as boolean) || false,
        includes: (fm.includes as string[]) || [],
        photo_key: fm.photo_key as string | undefined,
        tags: (fm.tags as string[]) || [],
        wikipedia: fm.wikipedia as string | undefined,
        operator: fm.operator as string | undefined,
      },
      body: body.trim(),
    });
  }
  return entries;
}

/**
 * Read locale translations for a bike path from two sources:
 * 1. .{locale}.md files (e.g., greenbelt-pathway.fr.md) — full translation with slug, name, vibe, body
 * 2. YML name_{locale} fields (e.g., name_fr from OSM's name:fr tag) — fallback name only
 *
 * For each non-primary locale in the city config, checks both sources.
 * .md file takes precedence over YML field for the name.
 */
function readBikePathTranslations(
  slug: string,
  ymlEntry: SluggedBikePathYml,
): Record<string, BikePathTranslation> {
  const bikePathsDir = path.join(cityDir, 'bike-paths');
  const translations: Record<string, BikePathTranslation> = {};
  const nonDefault = supportedLocales().filter(l => l !== defaultLocale());

  for (const locale of nonDefault) {
    // Source 1: .{locale}.md translation file
    const filePath = path.join(bikePathsDir, `${slug}.${locale}.md`);
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const { data: fm, content: body } = matter(raw);
      const trimmed = body.trim();
      translations[locale] = {
        ...(fm.slug ? { slug: fm.slug as string } : {}),
        ...(fm.name ? { name: fm.name as string } : {}),
        ...(fm.vibe ? { vibe: fm.vibe as string } : {}),
        ...(trimmed ? { body: trimmed } : {}),
      };
    }

    // Source 2: YML name_{locale} field (OSM name:xx tag) — fallback name
    const ymlLocName = (ymlEntry as Record<string, unknown>)[`name_${locale}`];
    if (typeof ymlLocName === 'string' && ymlLocName) {
      if (!translations[locale]) translations[locale] = {};
      if (!translations[locale].name) translations[locale].name = ymlLocName;
    }
  }

  return translations;
}

/**
 * Load and merge bike path data from YML + markdown + geometry — synchronously.
 *
 * This is the canonical merge function. It reads bikepaths.yml and bike-paths/*.md
 * directly from the filesystem (no Astro getCollection). Tier 2 relation fields
 * (overlappingRoutes, nearbyPhotos, etc.) default to empty — they are populated
 * later by the build-data-plugin enrichment step.
 */
export function loadBikePathEntries(): {
  pages: BikePathPage[];
  allYmlEntries: SluggedBikePathYml[];
  geoFiles: string[];
} {
  // 1. Parse bikepaths.yml (gracefully handle cities without bike paths)
  const ymlPath = path.join(cityDir, 'bikepaths.yml');
  const allYmlEntries = fs.existsSync(ymlPath)
    ? parseBikePathsYml(fs.readFileSync(ymlPath, 'utf-8'))
    : [];

  // 2. Load markdown files directly from filesystem
  const markdownEntries = readMarkdownEntries();

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

    const lengthParts = matchedEntries.map(e => getPathLengthKm(e) ?? 0);
    const totalLengthKm = lengthParts.reduce((s, v) => s + v, 0);

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
      listed: true,
      standalone: true,
      stub: md.data.stub ?? false,
      featured: md.data.featured ?? false,
      ymlEntries: matchedEntries,
      osmRelationIds,
      osmNames,
      geoFiles: entryGeoFiles(matchedEntries),
      length_km: totalLengthKm > 0 ? Math.round(totalLengthKm * 10) / 10 : undefined,
      points,
      routeCount: 0,
      overlappingRoutes: [],
      nearbyPhotos: [],
      nearbyPlaces: [],
      nearbyPaths: [],
      connectedPaths: [],
      surface: primary?.surface,
      width: primary?.width,
      lit: primary?.lit,
      segregated: primary?.segregated,
      smoothness: primary?.smoothness,
      operator: normalizeOperator(md.data.operator ?? primary?.operator),
      network: primary?.network,
      highway: primary?.highway,
      parallel_to: primary?.parallel_to,
      wikipedia: md.data.wikipedia ?? primary?.wikipedia,
      translations: primary ? readBikePathTranslations(md.id, primary) : {},
    });
  }

  // Collect slugs absorbed by grouped_from entries
  const absorbedSlugs = new Set<string>();
  for (const entry of allYmlEntries) {
    if (entry.grouped_from) {
      for (const slug of entry.grouped_from) absorbedSlugs.add(slug);
    }
  }

  // 6. Process all unclaimed YML entries (non-hard-excluded).
  // Every entry gets a page; `listed` is determined by score in Tier 2.
  for (const entry of allYmlEntries) {
    if (claimedSlugs.has(entry.slug)) continue;
    if (absorbedSlugs.has(entry.slug)) continue;
    if (isHardExcluded(entry)) continue;

    const score = scoreBikePath(entry, 0);

    // Grouped entries: merge member geometry like markdown includes
    if (entry.grouped_from && entry.grouped_from.length > 0) {
      const memberEntries: SluggedBikePathYml[] = [];
      for (const memberSlug of entry.grouped_from) {
        const member = ymlBySlug.get(memberSlug);
        if (member) memberEntries.push(member);
      }

      const allEntriesToMerge = [entry, ...memberEntries];
      const osmRelationIds = [...new Set(allEntriesToMerge.flatMap(e => e.osm_relations ?? []))];
      const osmNames = [...new Set(allEntriesToMerge.flatMap(e => e.osm_names ?? []))];
      const lengthParts = allEntriesToMerge.map(e => getPathLengthKm(e) ?? 0);
      const totalLengthKm = lengthParts.reduce((s, v) => s + v, 0);
      const points = allEntriesToMerge.flatMap(e => getPathPoints(e));

      pages.push({
        slug: entry.slug,
        name: entry.name,
        name_fr: entry.name_fr,
        tags: [],
        score,
        hasMarkdown: false,
        listed: true, // grouped entries are always listed
        standalone: true,
        stub: true,
        featured: false,
        ymlEntries: allEntriesToMerge,
        osmRelationIds,
        osmNames,
        geoFiles: entryGeoFiles(allEntriesToMerge),
        length_km: totalLengthKm > 0 ? Math.round(totalLengthKm * 10) / 10 : undefined,
        points,
        routeCount: 0,
        overlappingRoutes: [],
        nearbyPhotos: [],
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
        parallel_to: entry.parallel_to,
        wikipedia: entry.wikipedia,
        translations: readBikePathTranslations(entry.slug, entry),
      });
      continue;
    }

    pages.push({
      slug: entry.slug,
      name: entry.name,
      name_fr: entry.name_fr,
      tags: [],
      score,
      hasMarkdown: false,
      listed: score >= SCORE_THRESHOLD,
      standalone: true,
      stub: true, // all YML-only entries are stubs
      featured: false,
      ymlEntries: [entry],
      osmRelationIds: entry.osm_relations ?? [],
      osmNames: entry.osm_names ?? [],
      geoFiles: entryGeoFiles([entry]),
      length_km: getPathLengthKm(entry),
      points: getPathPoints(entry),
      routeCount: 0,
      overlappingRoutes: [],
      nearbyPhotos: [],
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
      parallel_to: entry.parallel_to,
      wikipedia: entry.wikipedia,
      translations: readBikePathTranslations(entry.slug, entry),
    });
  }

  // Scan for cached GeoJSON files (dev only — build uses inlined list from plugin)
  const geoDir = path.join(getProjectRoot(), 'public', 'bike-paths', 'geo');
  const geoFiles = fs.existsSync(geoDir)
    ? fs.readdirSync(geoDir).filter(f => f.endsWith('.geojson'))
    : [];

  return { pages, allYmlEntries, geoFiles };
}

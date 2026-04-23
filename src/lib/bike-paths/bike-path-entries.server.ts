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
import { parseBikePathsYml, geoFilesForEntry, type SluggedBikePathYml } from './bikepaths-yml.server';
import { readGeoFileData } from '../geo/geojson-reader.server';
import { scoreBikePath, isHardExcluded, isDestination } from './bike-path-scoring.server';
import { supportedLocales, defaultLocale } from '../i18n/locale-utils';
import { getCityConfig } from '../config/city-config';
import { loadSlugIndex } from './slug-index.server';
import { normalizeNameForComparison } from './normalize-name';

/** Merge `related:` values from markdown frontmatter and pipeline YAML.
 *  Markdown authors don't know about pipeline-emitted siblings (e.g. Rule 7
 *  MTB splits), and pipeline output doesn't know about editorial siblings.
 *  Union-merge so both sources contribute. Returns undefined if neither has
 *  values — keeps the field absent rather than writing `[]`. */
function mergeRelated(a?: string[], b?: string[]): string[] | undefined {
  const merged = [...new Set([...(a ?? []), ...(b ?? [])])];
  return merged.length > 0 ? merged : undefined;
}

function resolveWikidataDescription(entry?: SluggedBikePathYml): string | undefined {
  if (!entry?.wikidata_meta) return undefined;
  const locale = defaultLocale().split('-')[0]; // 'en' from 'en-CA'
  const meta = entry.wikidata_meta as Record<string, unknown>;
  return (meta[`description_${locale}`] as string) ?? (meta.description_en as string);
}

function resolveWikipediaExtract(entry?: SluggedBikePathYml): { extract?: string; url?: string } {
  if (!entry?.wikidata_meta) return {};
  const locale = defaultLocale().split('-')[0];
  const meta = entry.wikidata_meta as Record<string, unknown>;
  const extract = (meta[`wikipedia_extract_${locale}`] as string) ?? (meta.wikipedia_extract_en as string);
  const wp = entry.wikipedia;
  let url: string | undefined;
  if (wp) {
    const [lang, ...titleParts] = wp.split(':');
    const title = titleParts.join(':');
    url = `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
  }
  return { extract, url };
}

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
  /** The member's actual memberOf value — may differ from the network page slug. */
  memberOf?: string;
  /** Whether this member has a markdown file — used for tier 1/tier 2 display on index. */
  hasMarkdown: boolean;
  /** The member's entry type — used to distinguish long-distance trails from regular members. */
  entryType?: string;
  /** Non-cycling relations this member overlaps with — for network page grouping. */
  overlappingRelations?: Array<{ id: number; name: string; route: string }>;
  /** Surface type — for map popup display. */
  surface?: string;
  /** Infrastructure type — for map popup display. */
  path_type?: string;
  /** Short description — for map popup display. */
  vibe?: string;
}

/**
 * Pure projection: BikePathPage → MemberRef. Keep in sync with the MemberRef
 * interface above. Narrows overlapping_relations to {id, name, route} — the
 * richer fields on the source are intentionally dropped from the network-page
 * bundle.
 */
export function toMemberRef(p: BikePathPage): MemberRef {
  return {
    slug: p.slug,
    name: p.name,
    length_km: p.length_km,
    thumbnail_key: p.thumbnail_key,
    standalone: p.standalone,
    memberOf: p.memberOf,
    hasMarkdown: p.hasMarkdown,
    entryType: p.ymlEntries[0]?.type,
    overlappingRelations: p.overlapping_relations?.map(r => ({
      id: r.id,
      name: r.name,
      route: r.route,
    })),
    surface: p.surface,
    path_type: p.path_type,
    vibe: p.vibe,
  };
}

/** A bike path page to be generated — merged YML + markdown data. */
export interface BikePathPage {
  slug: string;
  name: string;
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
  /** Sibling-network slugs rendered as "also see X" links. Editorial (from
   *  markdown `related:` frontmatter) or pipeline-emitted (Rule 7 MTB split). */
  related?: string[];
  /** Named segments from tile-layer data — sub-stretches with distinct names. */
  segments?: Array<{ name: string; surface_mix: Array<{ value: string; km: number }> }>;
  /** For network pages: lightweight refs to member paths. */
  memberRefs?: MemberRef[];
  ymlEntries: SluggedBikePathYml[];
  osmRelationIds: number[];
  osmNames: string[];
  /** GeoJSON filenames for this path (e.g., "12345.geojson", "name-foo.geojson"). */
  geoFiles: string[];
  /** Geometry content hash from slug-index.json — used for map image proxy cache busting. */
  geoHash?: string;
  /** Geographic points for this path — from YML anchors or sampled GeoJSON geometry. */
  points: Array<{ lat: number; lng: number }>;
  /** Number of routes that overlap this path (precomputed at build config time). */
  routeCount: number;
  /** Precomputed route cards for routes that overlap this path. */
  overlappingRoutes: Array<{ slug: string; name: string; distance_km: number; coverKey?: string; distanceOnPathKm?: number }>;
  /** Geolocated photos taken near this path. */
  nearbyPhotos: Array<{ key: string; lat: number; lng: number; routeSlug: string; caption?: string }>;
  /** Precomputed nearby places (within 300m). */
  nearbyPlaces: Array<{ name: string; category: string; lat: number; lng: number; distance_m: number }>;
  /** Precomputed nearby paths (within 2km). */
  nearbyPaths: Array<{ slug: string; name: string; surface?: string; memberOf?: string; length_km?: number }>;
  /** Precomputed connected paths (endpoints within 200m). */
  connectedPaths: Array<{ slug: string; name: string; surface?: string; memberOf?: string; length_km?: number }>;
  /** Wikipedia article reference — "en:Article Title" format. */
  wikipedia?: string;
  /** Resolved thumbnail key for index display (photo_key → route cover → map PNG). */
  thumbnail_key?: string;
  /** Total path length in km, computed from GeoJSON geometry. */
  length_km?: number;
  /** Elevation gain in meters (from enriched GeoJSON, if available). */
  elevation_gain_m?: number;
  surface?: string;
  surface_mix?: Array<{ value: string; km: number }>;
  width?: string;
  lit?: string;
  lit_mix?: Array<{ value: string; km: number }>;
  segregated?: string;
  smoothness?: string;
  operator?: string;
  network?: string;
  /** OSM cycle_network tag (e.g. "CA:ON:Ottawa") — signals a cycleway network. */
  cycle_network?: string;
  highway?: string;
  /** OSM cycleway tag: 'track', 'lane', 'shared_lane', 'crossing'. */
  cycleway?: string;
  /** OSM bicycle access: 'designated', 'yes', 'no'. */
  bicycle?: string;
  /** OSM foot access: 'designated', 'yes', 'no'. */
  foot?: string;
  /** OSM incline: '0%', 'up', 'down', '>10%'. */
  incline?: string;
  /** OSM access: 'yes', 'no', 'private', 'permissive'. */
  access?: string;
  /** Road name this path runs alongside (for parallel bike lanes). */
  parallel_to?: string;
  /** Mountain bike trail (not road-bike-friendly). Set by detect-mtb in the data pipeline. */
  mtb?: boolean;
  /** Infrastructure type (mup, separated-lane, bike-lane, paved-shoulder, mtb-trail, trail). */
  path_type?: string;
  /** Official website URL (from YML website or wikidata_meta.website). */
  website?: string;
  /** Seasonal restriction (e.g., "winter" for winter-only trails). */
  seasonal?: string;
  /** Reference code from OSM signs (e.g., "RV1", "CP-7"). */
  ref?: string;
  /** Wikidata description for the current build locale — fallback body text for stubs. */
  wikidata_description?: string;
  /** Year/date the path was established (from wikidata_meta.inception). */
  inception?: string;
  /** Wikimedia Commons image filename — from wikidata_meta.commons_image. */
  commons_image?: string;
  /** Wikimedia Commons category name — from wikidata_meta.commons_category. */
  commons_category?: string;
  /** Wikidata operator Q-ID — for linking to Wikidata entity page. */
  wikidata_operator_qid?: string;
  /** Operator's official website — from Wikidata P856 on the operator entity. */
  operator_website?: string;
  /** Social media links from Wikidata. */
  wikidata_social?: Array<{ platform: string; username: string; url: string }>;
  /** Wikipedia extract (plain text first paragraph) for the current build locale. */
  wikipedia_extract?: string;
  /** Wikipedia article URL for the current build locale. */
  wikipedia_url?: string;
  /** Park name from OSM containment — set when the path is inside a park polygon. */
  park?: string;
  /** Original OSM route type for non-cycling relations (foot, hiking, piste). Absent for cycling-first. */
  route_type?: string;
  /** Entry type from the pipeline: long-distance, network, destination, infrastructure, connector. */
  entryType: string;
  /** Non-cycling route relations that share ways with this entry. */
  overlapping_relations?: Array<{
    id: number;
    name: string;
    route: string;
    operator?: string;
    ref?: string;
    network?: string;
    wikipedia?: string;
    website?: string;
  }>;
  /** Locale-specific content overrides from .{locale}.md files, markdown frontmatter + YML name_{locale}. */
  translations: Record<string, BikePathTranslation>;
}

let cachedOperatorAliases: Array<{ pattern: RegExp; canonical: string }> | null = null;

function getOperatorAliases(): Array<{ pattern: RegExp; canonical: string }> {
  if (cachedOperatorAliases) return cachedOperatorAliases;
  const config = getCityConfig();
  const aliases = (config as unknown as Record<string, unknown>).operator_aliases as Record<string, string[]> | undefined;
  cachedOperatorAliases = aliases
    ? Object.entries(aliases).map(([canonical, variants]) => ({
        pattern: new RegExp(`\\b(${variants.join('|')})\\b`, 'i'),
        canonical,
      }))
    : [];
  return cachedOperatorAliases;
}

/** Normalize operator names — OSM has many variants for the same org. */
export function normalizeOperator(operator: string | undefined): string | undefined {
  if (!operator) return undefined;
  for (const alias of getOperatorAliases()) {
    if (alias.pattern.test(operator)) return alias.canonical;
  }
  return operator;
}

/** Read sampled points from a GeoJSON file (delegates to single-pass reader). */
function readGeoPoints(filePath: string): Array<{ lat: number; lng: number }> {
  return readGeoFileData(filePath).points;
}

/** Compute total length (km) of all LineString/MultiLineString features in a GeoJSON file (delegates to single-pass reader). */
function readGeoLengthKm(filePath: string): number {
  return readGeoFileData(filePath).lengthKm;
}

/** Compute total length (km) for a path from all its GeoJSON files. */
function getPathLengthKm(entry: SluggedBikePathYml): number | undefined {
  const geoDir = path.join(getProjectRoot(), 'public', 'bike-paths', 'geo');
  let totalKm = 0;
  for (const file of geoFilesForEntry(entry)) {
    totalKm += readGeoLengthKm(path.join(geoDir, file));
  }
  return totalKm > 0 ? Math.round(totalKm * 10) / 10 : undefined;
}

/** Get geographic points for a path: GeoJSON geometry first, YML anchors as fallback. */
function getPathPoints(entry: SluggedBikePathYml): Array<{ lat: number; lng: number }> {
  const geoDir = path.join(getProjectRoot(), 'public', 'bike-paths', 'geo');
  const points: Array<{ lat: number; lng: number }> = [];

  for (const file of geoFilesForEntry(entry)) {
    points.push(...readGeoPoints(path.join(geoDir, file)));
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
  return entries.flatMap(e => geoFilesForEntry(e));
}

/** Parsed markdown frontmatter for a bike-path .md file. */
interface MarkdownEntry {
  id: string;
  data: {
    name?: string;
    vibe?: string;
    hidden: boolean;
    stub: boolean;
    featured: boolean;
    includes: string[];
    related?: string[];
    photo_key?: string;
    tags: string[];
    wikipedia?: string;
    operator?: string;
  };
  /** Raw frontmatter object — used to pass dynamic name_{locale} keys to readBikePathTranslations. */
  rawFrontmatter: Record<string, unknown>;
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
        vibe: fm.vibe as string | undefined,
        hidden: (fm.hidden as boolean) || false,
        stub: (fm.stub as boolean) || false,
        featured: (fm.featured as boolean) || false,
        includes: (fm.includes as string[]) || [],
        related: fm.related as string[] | undefined,
        photo_key: fm.photo_key as string | undefined,
        tags: (fm.tags as string[]) || [],
        wikipedia: fm.wikipedia as string | undefined,
        operator: fm.operator as string | undefined,
      },
      rawFrontmatter: fm as Record<string, unknown>,
      body: body.trim(),
    });
  }
  return entries;
}

/**
 * Read locale translations for a bike path from three sources (highest to lowest priority):
 * 1. .{locale}.md files (e.g., greenbelt-pathway.fr.md) — full translation with slug, name, vibe, body
 * 2. Main markdown frontmatter name_{locale} fields (e.g., name_fr in rideau-canal-pathway.md)
 * 3. YML name_{locale} fields (e.g., name_fr from OSM's name:fr tag) — fallback name only
 *
 * This is the single source of truth for locale-specific names on bike paths.
 *
 * For each non-primary locale in the city config, checks all three sources.
 * .md file takes precedence over frontmatter, which takes precedence over YML.
 */
function readBikePathTranslations(
  slug: string,
  ymlEntry: SluggedBikePathYml,
  markdownFrontmatter?: Record<string, unknown>,
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

    // Source 2: Main markdown frontmatter name_{locale} field
    if (markdownFrontmatter) {
      const mdLocName = markdownFrontmatter[`name_${locale}`];
      if (typeof mdLocName === 'string' && mdLocName) {
        if (!translations[locale]) translations[locale] = {};
        if (!translations[locale].name) translations[locale].name = mdLocName;
      }
    }

    // Source 3: YML name_{locale} field (OSM name:xx tag) — fallback name
    const ymlLocName = (ymlEntry as Record<string, unknown>)[`name_${locale}`];
    if (typeof ymlLocName === 'string' && ymlLocName) {
      if (!translations[locale]) translations[locale] = {};
      if (!translations[locale].name) translations[locale].name = ymlLocName;
    }
  }

  return translations;
}

/** Memoized result — set on first call, returned on subsequent calls. */
let cachedBikePathEntries: { pages: BikePathPage[]; allYmlEntries: SluggedBikePathYml[]; geoFiles: string[] } | null = null;

/**
 * Load and merge bike path data from YML + markdown + geometry — synchronously.
 *
 * This is the canonical merge function. It reads bikepaths.yml and bike-paths/*.md
 * directly from the filesystem (no Astro getCollection). Tier 2 relation fields
 * (overlappingRoutes, nearbyPhotos, etc.) default to empty — they are populated
 * later by the build-data-plugin enrichment step.
 *
 * Results are memoized at module level — the merge is only computed once per process.
 */
export function loadBikePathEntries(): {
  pages: BikePathPage[];
  allYmlEntries: SluggedBikePathYml[];
  geoFiles: string[];
} {
  if (cachedBikePathEntries) return cachedBikePathEntries;

  // Feature flag: return empty data when bike paths are disabled.
  // Prevents Zod validation of bikepaths.yml when the schema on this
  // branch may not match the data repo's current format.
  if (process.env.ENABLE_BIKE_PATHS === 'false') {
    cachedBikePathEntries = { pages: [], allYmlEntries: [], geoFiles: [] };
    return cachedBikePathEntries;
  }

  // 1. Parse bikepaths.yml (gracefully handle cities without bike paths)
  const ymlPath = path.join(cityDir, 'bikepaths.yml');
  const parsed = fs.existsSync(ymlPath)
    ? parseBikePathsYml(fs.readFileSync(ymlPath, 'utf-8'))
    : { entries: [] as SluggedBikePathYml[], superNetworks: [] };
  const allYmlEntries = parsed.entries;

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
  // Markdown overlays for network entries — stashed here, applied in step 7
  const networkMarkdownOverlays = new Map<string, typeof markdownEntries[0]>();

  // 5. Process markdown files first (they have priority)
  for (const md of markdownEntries) {
    if (md.data.hidden) continue;

    const includes = md.data.includes ?? [];
    const matchedEntries: SluggedBikePathYml[] = [];

    for (const inc of includes) {
      const entry = ymlBySlug.get(inc);
      if (entry) {
        matchedEntries.push(entry);
        // Multi-entry includes create network-like grouping pages — don't claim
        // the entries so they still get their own pages (needed for memberRefs).
        if (includes.length <= 1) claimedSlugs.add(inc);
      }
    }

    if (matchedEntries.length === 0) {
      const entry = ymlBySlug.get(md.id);
      if (entry) {
        matchedEntries.push(entry);
        // If this YML entry has members (network or trail with sections), don't
        // claim it — stash the markdown overlay for step 7 so the page gets built
        // with member refs and markdown content.
        if ((entry.members?.length ?? 0) > 0) {
          networkMarkdownOverlays.set(md.id, md);
          continue;
        }
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
      memberOf: primary?.member_of,
      related: mergeRelated(md.data.related, primary?.related),
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
      surface_mix: primary?.surface_mix,
      width: primary?.width,
      lit: primary?.lit,
      lit_mix: primary?.lit_mix,
      segregated: primary?.segregated,
      smoothness: primary?.smoothness,
      operator: normalizeOperator(md.data.operator ?? primary?.operator) ?? primary?.wikidata_meta?.operator,
      network: primary?.network,
      cycle_network: primary?.cycle_network,
      highway: primary?.highway,
      cycleway: primary?.cycleway,
      bicycle: primary?.bicycle,
      foot: primary?.foot,
      incline: primary?.incline,
      access: primary?.access,
      parallel_to: primary?.parallel_to,
      mtb: primary?.mtb,
      path_type: primary?.path_type,
      website: primary?.website ?? primary?.wikidata_meta?.website,
      seasonal: primary?.seasonal,
      ref: primary?.ref,
      park: primary?.park,
      route_type: primary?.route_type,
      wikidata_description: resolveWikidataDescription(primary),
      inception: primary?.wikidata_meta?.inception,
      commons_image: primary?.wikidata_meta?.commons_image,
      commons_category: primary?.wikidata_meta?.commons_category,
      wikidata_operator_qid: primary?.wikidata_meta?.operator_qid,
      operator_website: primary?.wikidata_meta?.operator_website,
      wikidata_social: primary?.wikidata_meta?.social,
      wikipedia_extract: resolveWikipediaExtract(primary).extract,
      wikipedia_url: resolveWikipediaExtract(primary).url,
      wikipedia: md.data.wikipedia ?? primary?.wikipedia,
      entryType: primary?.type ?? 'unknown',
      overlapping_relations: primary?.overlapping_relations,
      translations: primary ? readBikePathTranslations(md.id, primary, md.rawFrontmatter) : {},
    });
  }

  // 6. Process all unclaimed YML entries (non-hard-excluded).
  // `listed` is type-based: destination/infrastructure are listed, connector/untyped are not.
  // Member entries stay in the file and get their own pages.
  for (const entry of allYmlEntries) {
    if (claimedSlugs.has(entry.slug)) continue;
    if (isHardExcluded(entry)) continue;

    const score = scoreBikePath(entry, 0);

    // Skip entries with members (networks, trails with sections) — processed in step 7
    if ((entry.members?.length ?? 0) > 0) continue;

    pages.push({
      slug: entry.slug,
      name: entry.name,
      tags: [],
      score,
      hasMarkdown: false,
      listed: entry.type === 'long-distance' || entry.type === 'destination' || entry.type === 'infrastructure',
      standalone: isDestination(entry, false, false),
      stub: true, // all YML-only entries are stubs
      featured: false,
      memberOf: entry.member_of,
      related: entry.related,
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
      surface_mix: entry.surface_mix,
      width: entry.width,
      lit: entry.lit,
      lit_mix: entry.lit_mix,
      segregated: entry.segregated,
      smoothness: entry.smoothness,
      operator: normalizeOperator(entry.operator) ?? entry.wikidata_meta?.operator,
      network: entry.network,
      cycle_network: entry.cycle_network,
      highway: entry.highway,
      cycleway: entry.cycleway,
      bicycle: entry.bicycle,
      foot: entry.foot,
      incline: entry.incline,
      access: entry.access,
      parallel_to: entry.parallel_to,
      mtb: entry.mtb,
      path_type: entry.path_type,
      website: entry.website ?? entry.wikidata_meta?.website,
      seasonal: entry.seasonal,
      ref: entry.ref,
      park: entry.park,
      route_type: entry.route_type,
      wikidata_description: resolveWikidataDescription(entry),
      inception: entry.wikidata_meta?.inception,
      commons_image: entry.wikidata_meta?.commons_image,
      commons_category: entry.wikidata_meta?.commons_category,
      wikidata_operator_qid: entry.wikidata_meta?.operator_qid,
      operator_website: entry.wikidata_meta?.operator_website,
      wikidata_social: entry.wikidata_meta?.social,
      wikipedia_extract: resolveWikipediaExtract(entry).extract,
      wikipedia_url: resolveWikipediaExtract(entry).url,
      wikipedia: entry.wikipedia,
      entryType: entry.type,
      overlapping_relations: entry.overlapping_relations,
      translations: readBikePathTranslations(entry.slug, entry),
    });
  }

  // 7. Process entries with members — networks AND trails with sections.
  // These pages aggregate metadata from members. memberRefs are lightweight —
  // slug, name, length, thumbnail, standalone — NOT full BikePathPage objects.
  // The virtual module (build-data-plugin.ts) serializes all pages into a JS bundle;
  // embedding full page objects inside network pages would duplicate large relation arrays.
  const pageBySlug = new Map(pages.map(p => [p.slug, p]));
  for (const entry of allYmlEntries) {
    if (!((entry.members?.length ?? 0) > 0)) continue;
    if (claimedSlugs.has(entry.slug)) continue;
    if (isHardExcluded(entry)) continue;

    const memberSlugs = entry.members ?? [];
    // Guard: warn about entries that reference other member-bearing entries
    const nestedMemberSlugs = memberSlugs.filter(s => {
      const yml = ymlBySlug.get(s);
      return (yml?.members?.length ?? 0) > 0;
    });
    if (nestedMemberSlugs.length > 0) {
      console.warn(`"${entry.slug}" references other member-bearing entries: ${nestedMemberSlugs.join(', ')} — skipped`);
    }
    const memberPages = memberSlugs
      .filter(s => !nestedMemberSlugs.includes(s))
      .map(s => pageBySlug.get(s))
      .filter((p): p is BikePathPage => !!p);

    // A network needs ≥2 resolved members with at least one standalone page.
    // Otherwise clear memberOf so members stay at flat URLs.
    const standaloneCount = memberPages.filter(p => p.standalone).length;
    if (memberPages.length < 2 || standaloneCount === 0) {
      for (const mp of memberPages) {
        mp.memberOf = undefined;
      }
      continue;
    }

    const memberRefs: MemberRef[] = memberPages.map(toMemberRef);

    // Aggregate geometry from all members
    const allMemberEntries = memberPages.flatMap(p => p.ymlEntries);
    const allEntries = [entry, ...allMemberEntries];
    const osmRelationIds = [...new Set(allEntries.flatMap(e => e.osm_relations ?? []))];
    const osmNames = [...new Set(allEntries.flatMap(e => e.osm_names ?? []))];
    const points = memberPages.flatMap(p => p.points);

    // Network length: prefer wikidata_meta.length_km, fallback to sum of member lengths
    const wikidataLength = entry.wikidata_meta?.length_km;
    const sumLength = memberPages.reduce((sum, p) => sum + (p.length_km ?? 0), 0);
    const totalLengthKm = wikidataLength ?? (sumLength > 0 ? Math.round(sumLength * 10) / 10 : undefined);

    const score = scoreBikePath(entry, 0);

    // Apply markdown overlay if a markdown file matches this network
    const mdOverlay = networkMarkdownOverlays.get(entry.slug);

    pages.push({
      slug: entry.slug,
      name: mdOverlay?.data.name ?? entry.name,
      vibe: mdOverlay?.data.vibe,
      body: mdOverlay?.body,
      photo_key: mdOverlay?.data.photo_key,
      tags: mdOverlay?.data.tags ?? [],
      score,
      hasMarkdown: !!mdOverlay,
      listed: true,
      standalone: true,
      stub: !mdOverlay,
      featured: mdOverlay?.data.featured ?? false,
      memberRefs,
      ymlEntries: [entry],
      osmRelationIds,
      osmNames,
      geoFiles: entryGeoFiles(allEntries),
      length_km: totalLengthKm,
      points,
      routeCount: 0,
      overlappingRoutes: [],
      nearbyPhotos: [],
      nearbyPlaces: [],
      nearbyPaths: [],
      connectedPaths: [],
      surface: entry.surface,
      surface_mix: entry.surface_mix,
      width: entry.width,
      lit: entry.lit,
      lit_mix: entry.lit_mix,
      segregated: entry.segregated,
      smoothness: entry.smoothness,
      operator: normalizeOperator(mdOverlay?.data.operator ?? entry.operator) ?? entry.wikidata_meta?.operator,
      network: entry.network,
      highway: entry.highway,
      wikidata_description: resolveWikidataDescription(entry),
      inception: entry.wikidata_meta?.inception,
      commons_image: entry.wikidata_meta?.commons_image,
      commons_category: entry.wikidata_meta?.commons_category,
      wikidata_operator_qid: entry.wikidata_meta?.operator_qid,
      operator_website: entry.wikidata_meta?.operator_website,
      wikidata_social: entry.wikidata_meta?.social,
      wikipedia_extract: resolveWikipediaExtract(entry).extract,
      wikipedia_url: resolveWikipediaExtract(entry).url,
      wikipedia: mdOverlay?.data.wikipedia ?? entry.wikipedia,
      entryType: entry.type,
      translations: readBikePathTranslations(entry.slug, entry, mdOverlay?.rawFrontmatter),
    });
  }

  // 8. Resolve memberRefs for multi-entry includes: pages.
  // These are markdown grouping pages that claimed multiple YML entries in step 5
  // but didn't get memberRefs (that's step 7's job for YML networks). Now that all
  // individual member pages exist, build memberRefs so they display as networks.
  for (const p of pages) {
    if (p.memberRefs || p.ymlEntries.length < 2) continue;
    // Only includes: pages have multiple ymlEntries from step 5
    if (!p.hasMarkdown) continue;
    const memberPages = p.ymlEntries
      .map((e: SluggedBikePathYml) => pageBySlug.get(e.slug))
      .filter((mp: BikePathPage | undefined): mp is BikePathPage => !!mp && mp.slug !== p.slug);
    if (memberPages.length < 2) continue;
    p.memberRefs = memberPages.map(toMemberRef);
  }

  // 9. Load segments from tile features for detail-page rendering.
  const slugIndex = loadSlugIndex();
  const tileDir = path.join(getProjectRoot(), 'public', 'bike-paths', 'geo', 'tiles');

  // Cache loaded tile data to avoid re-reading the same tile file
  const tileCache = new Map<string, unknown>();
  function loadTile(tileId: string) {
    if (tileCache.has(tileId)) return tileCache.get(tileId);
    const filePath = path.join(tileDir, `tile-${tileId}.geojson`);
    if (!fs.existsSync(filePath)) { tileCache.set(tileId, null); return null; }
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    tileCache.set(tileId, data);
    return data;
  }

  for (const page of pages) {
    const indexEntry = slugIndex[page.slug];
    if (!indexEntry) continue;

    const seenNames = new Set<string>();
    const segments: Array<{ name: string; surface_mix: Array<{ value: string; km: number }> }> = [];

    for (const tileId of indexEntry.tiles) {
      const tile = loadTile(tileId) as { features: Array<{ properties: { slug?: string; _segments?: Array<{ name?: string; surface_mix: Array<{ value: string; km: number }> }> } }> } | null;
      if (!tile) continue;

      for (const feature of tile.features) {
        if (feature.properties.slug !== page.slug) continue;
        for (const seg of feature.properties._segments ?? []) {
          if (!seg.name || seenNames.has(seg.name)) continue;
          seenNames.add(seg.name);
          segments.push({ name: seg.name, surface_mix: seg.surface_mix });
        }
      }
    }

    // Only attach if there are named segments different from the page name
    const hasDistinct = segments.some(s =>
      normalizeNameForComparison(s.name) !== normalizeNameForComparison(page.name)
    );
    if (hasDistinct && segments.length > 0) page.segments = segments;
  }

  // Scan for cached GeoJSON files (dev only — build uses inlined list from plugin)
  const geoDir = path.join(getProjectRoot(), 'public', 'bike-paths', 'geo');
  const geoFiles = fs.existsSync(geoDir)
    ? fs.readdirSync(geoDir).filter(f => f.endsWith('.geojson'))
    : [];

  cachedBikePathEntries = { pages, allYmlEntries, geoFiles };
  return cachedBikePathEntries;
}

/**
 * View-model builder for /bike-paths — the index page.
 *
 * The view file (src/views/paths/index.astro) loads raw BikePathPage data,
 * calls `buildPathsIndexData(...)`, and renders the result. All grouping,
 * classification, URL resolution, locale text resolution, bounds/geoId
 * aggregation, and long-distance-member extraction happens here.
 *
 * Helpers are exported so unit tests can exercise individual concerns
 * (partitioning, category assembly, geoId exclusion) without running the
 * whole pipeline.
 */

import { paths } from '../paths';
import { boundsFromPoints, type Bounds } from '../geo/bounds';
import type { BikePathPage, MemberRef } from './bike-path-entries.server';
import type { Translator } from './bike-path-facts';
import { localizeSurface, localizePathType } from './bike-path-facts';
import {
  classifyNetwork as classifyNetworkByMembers,
  classifyIndependentPath,
  splitMemberTiers,
  type BrowseCategory,
} from './index-categories';
import { compareMemberNames } from './member-sort';

// ── Constants ────────────────────────────────────────────────────────

/** Members shorter than this km value are filtered out of networks entirely. */
const MEMBER_MIN_KM = 0.5;

/** Standalone MUPs shorter than this (and without markdown) are demoted
 * from Pathways into the "other paths" bucket — they're connectors, not
 * destinations riders plan around. */
const STANDALONE_FEATURED_MIN_KM = 3;

/** Category keys that receive injected classified independent paths in
 * display order. local_trails + long_distance_trails are handled specially
 * above (local_trails pushed directly, long_distance_trails merges LD
 * member refs) and are NOT in this list. */
const INDEPENDENT_INJECTION_ORDER: BrowseCategory[] = ['pathways', 'bikeways', 'mtb'];

/** i18n label key per category — single source of truth. */
const CATEGORY_LABEL_KEYS: Record<BrowseCategory, string> = {
  pathways: 'paths.cat_pathways',
  bikeways: 'paths.cat_bikeways',
  local_trails: 'paths.cat_local_trails',
  long_distance_trails: 'paths.cat_long_distance_trails',
  mtb: 'paths.cat_mtb',
};

// ── Public types ─────────────────────────────────────────────────────

/** A tier-1 or tier-2 member rendered inside a network row. */
export interface TierMember {
  slug: string;
  name: string;
  length_km?: number;
  /** Detail page URL, or undefined when the member has no standalone page. */
  url?: string;
}

/** A network (group of member paths) rendered inside a category tab. */
export interface NetworkInfo {
  slug: string;
  name: string;
  url: string;
  length_km?: number;
  operator?: string;
  tier1: TierMember[];
  tier2: TierMember[];
}

/** A standalone path rendered in a category or the "other" tab. All
 *  text fields are already locale-resolved. */
export interface StandalonePathInfo {
  slug: string;
  name: string;
  url: string;
  length_km?: number;
  /** Localized surface label, already passed through `localizeSurface`. */
  surface?: string;
}

/** One browse tab. */
export interface CategoryData {
  key: BrowseCategory;
  label: string;
  networks: NetworkInfo[];
  standalonePaths: StandalonePathInfo[];
}

/** Popup content for a single path, keyed by slug. */
export interface SlugPopupInfo {
  name: string;
  url: string;
  length_km?: number;
  surface?: string;
  path_type?: string;
  vibe?: string;
  network?: string;
  networkUrl?: string;
}

/** Map data injected into `data-*` attributes for the client script. */
export interface PathsIndexMapData {
  networkGeoIds: Record<string, string[]>;
  categoryGeoIds: Record<string, string[]>;
  slugInfo: Record<string, SlugPopupInfo>;
  slugToNetwork: Record<string, string>;
  networkBounds: Record<string, Bounds>;
  categoryBounds: Record<string, Bounds>;
}

/** Everything the index view needs. */
export interface PathsIndexData {
  categories: CategoryData[];
  uncategorized: StandalonePathInfo[];
  map: PathsIndexMapData;
  /** Number of listed paths — used for the SEO description. */
  pathCount: number;
}

// ── Locale accessors ─────────────────────────────────────────────────

function pathName(p: BikePathPage, locale: string | undefined): string {
  return (locale && p.translations[locale]?.name) || p.name;
}

function pathVibe(p: BikePathPage, locale: string | undefined): string | undefined {
  return (locale && p.translations[locale]?.vibe) || p.vibe;
}

// ── Projections ──────────────────────────────────────────────────────

function toStandalonePathInfo(
  p: BikePathPage,
  locale: string | undefined,
  t: Translator,
): StandalonePathInfo {
  return {
    slug: p.slug,
    name: pathName(p, locale),
    url: paths.bikePath(p.slug, p.memberOf, locale),
    length_km: p.length_km,
    surface: localizeSurface(p.surface, t, locale),
  };
}

function toTierMember(
  m: MemberRef,
  fallbackNetworkSlug: string,
  locale: string | undefined,
): TierMember {
  return {
    slug: m.slug,
    name: m.name,
    length_km: m.length_km,
    url: m.standalone ? paths.bikePath(m.slug, m.memberOf ?? fallbackNetworkSlug, locale) : undefined,
  };
}

// ── Member partitioning ──────────────────────────────────────────────

/**
 * Split a network's member refs into "local" members (shown inside the
 * network) and long-distance members (extracted to the Trails tab).
 * Members below MEMBER_MIN_KM are dropped entirely.
 *
 * Replaces the mutating side effect inside the old buildNetworkInfo —
 * this function is pure and returns both halves.
 */
export function partitionNetworkMembers(net: BikePathPage): {
  localRefs: MemberRef[];
  longDistanceMemberRefs: MemberRef[];
} {
  const refs = (net.memberRefs ?? []).filter(m => m.length_km == null || m.length_km >= MEMBER_MIN_KM);
  const localRefs: MemberRef[] = [];
  const longDistanceMemberRefs: MemberRef[] = [];
  for (const m of refs) {
    if (m.entryType === 'long-distance') longDistanceMemberRefs.push(m);
    else localRefs.push(m);
  }
  return { localRefs, longDistanceMemberRefs };
}

// ── Network classification (member-aware wrapper) ────────────────────

function classifyNetworkForIndex(
  net: BikePathPage,
  pageBySlug: Map<string, BikePathPage>,
): BrowseCategory {
  const memberPathTypes = (net.memberRefs ?? []).map(m => pageBySlug.get(m.slug)?.path_type ?? '');
  return classifyNetworkByMembers(net.entryType, net.network, memberPathTypes, net.cycle_network);
}

// ── Network info builder (pure: no hidden mutation) ──────────────────

/**
 * Project a network page + its already-partitioned local members into
 * a NetworkInfo. Network length is recomputed from the kept members —
 * extracted long-distance members don't count toward the displayed total.
 */
export function buildNetworkInfo(
  net: BikePathPage,
  localRefs: MemberRef[],
  locale: string | undefined,
): NetworkInfo {
  const { tier1, tier2 } = splitMemberTiers(localRefs);
  tier1.sort(compareMemberNames);
  tier2.sort(compareMemberNames);

  const displayLength = localRefs.reduce((sum, m) => sum + (m.length_km ?? 0), 0);
  const length_km = displayLength > 0 ? Math.round(displayLength * 10) / 10 : net.length_km;

  return {
    slug: net.slug,
    name: pathName(net, locale),
    url: paths.bikePath(net.slug, undefined, locale),
    length_km,
    operator: net.operator,
    tier1: tier1.map(m => toTierMember(m, net.slug, locale)),
    tier2: tier2.map(m => toTierMember(m, net.slug, locale)),
  };
}

// ── Independent path classification ──────────────────────────────────

/** Classify every independent (standalone non-network non-member) path
 *  into a category bucket or the uncategorized bucket. */
export function classifyIndependentPaths(independent: BikePathPage[]): {
  byCategory: Partial<Record<BrowseCategory, BikePathPage[]>>;
  uncategorized: BikePathPage[];
} {
  const byCategory: Partial<Record<BrowseCategory, BikePathPage[]>> = {};
  const uncategorized: BikePathPage[] = [];
  for (const p of independent) {
    const cat = classifyIndependentPath(p.entryType, p.path_type);
    if (cat) {
      (byCategory[cat] ??= []).push(p);
    } else {
      uncategorized.push(p);
    }
  }
  return { byCategory, uncategorized };
}

/** Is this standalone path "featured enough" to show in the Pathways
 *  tab, or is it a short connector that belongs in "other paths"? */
function isFeaturedStandalone(p: BikePathPage): boolean {
  return p.hasMarkdown || (p.length_km != null && p.length_km >= STANDALONE_FEATURED_MIN_KM);
}

// ── Category assembly ────────────────────────────────────────────────

/**
 * Assemble the ordered list of browse tabs. Handles:
 *   - Fixed display order: pathways → mtb → trails → bikeways
 *   - Trails tab merges standalone trails + extracted long-distance members
 *   - Independent paths injected into their classified tabs
 *   - Short/anonymous MUPs demoted from Pathways into the uncategorized bucket
 */
export function assembleCategories(params: {
  categoryMap: Record<BrowseCategory, NetworkInfo[]>;
  independentByCategory: Partial<Record<BrowseCategory, BikePathPage[]>>;
  initialUncategorized: BikePathPage[];
  longDistanceMemberRefs: MemberRef[];
  pageBySlug: Map<string, BikePathPage>;
  locale: string | undefined;
  t: Translator;
}): { categories: CategoryData[]; uncategorized: BikePathPage[] } {
  const { categoryMap, independentByCategory, longDistanceMemberRefs, pageBySlug, locale, t } = params;
  const uncategorized = [...params.initialUncategorized];

  // Local trails standalones = independent paths classified into local_trails
  // (path_type=trail, or short long-distance entries below LONG_DISTANCE_MIN_KM).
  const localTrailsIndependents = independentByCategory.local_trails ?? [];

  // Long-distance standalones = independent long-distance paths + extracted
  // LD members pulled out of long-distance networks (deduped, sorted by km).
  const longDistanceIndependents = independentByCategory.long_distance_trails ?? [];
  const longDistanceSlugs = new Set(longDistanceIndependents.map(p => p.slug));
  const extractedLdPages: BikePathPage[] = [];
  for (const m of longDistanceMemberRefs) {
    if (longDistanceSlugs.has(m.slug)) continue;
    longDistanceSlugs.add(m.slug);
    const page = pageBySlug.get(m.slug);
    if (page) extractedLdPages.push(page);
  }
  const longDistanceStandalonePages = [...longDistanceIndependents, ...extractedLdPages]
    .sort((a, b) => (b.length_km ?? 0) - (a.length_km ?? 0));

  const toInfos = (pages: BikePathPage[]): StandalonePathInfo[] =>
    pages.map(p => toStandalonePathInfo(p, locale, t));

  const categories: CategoryData[] = [];
  const pushCategory = (
    key: BrowseCategory,
    standalonePages: BikePathPage[] = [],
  ): void => {
    const networks = categoryMap[key];
    if (networks.length === 0 && standalonePages.length === 0) return;
    categories.push({
      key,
      label: t(CATEGORY_LABEL_KEYS[key], locale),
      networks,
      standalonePaths: toInfos(standalonePages),
    });
  };

  pushCategory('pathways');
  pushCategory('bikeways');
  pushCategory('local_trails', localTrailsIndependents);
  pushCategory('long_distance_trails', longDistanceStandalonePages);
  pushCategory('mtb');

  // Inject classified independents into their tabs. Pathways demotes
  // short/anonymous MUPs into the uncategorized bucket.
  for (const catKey of INDEPENDENT_INJECTION_ORDER) {
    const catPages = independentByCategory[catKey] ?? [];
    if (catPages.length === 0) continue;

    let featuredPages = catPages;
    if (catKey === 'pathways') {
      featuredPages = catPages.filter(isFeaturedStandalone);
      const minor = catPages.filter(p => !isFeaturedStandalone(p));
      uncategorized.push(...minor);
    }
    if (featuredPages.length === 0) continue;

    const featuredInfos = toInfos(featuredPages);
    const existing = categories.find(c => c.key === catKey);
    if (existing) {
      existing.standalonePaths = [...existing.standalonePaths, ...featuredInfos];
    } else {
      categories.push({
        key: catKey,
        label: t(CATEGORY_LABEL_KEYS[catKey], locale),
        networks: [],
        standalonePaths: featuredInfos,
      });
    }
  }

  return { categories, uncategorized };
}

// ── Slug popup info ──────────────────────────────────────────────────

/**
 * Build `{slugInfo, slugToNetwork}` for the client map.
 *
 *   slugInfo         — popup content keyed by path slug
 *   slugToNetwork    — child-slug → parent-network-slug (for fly-to framing)
 *
 * Network pages that have members are listed in slugInfo only if they're
 * standalone. Their aggregated geometry is NOT registered — members
 * already carry their own geoIds, so overwriting would route member
 * clicks to the parent network instead of the clicked path.
 */
export function buildSlugPopupInfo(
  allPages: BikePathPage[],
  locale: string | undefined,
  t: Translator,
): { slugInfo: Record<string, SlugPopupInfo>; slugToNetwork: Record<string, string> } {
  const slugInfo: Record<string, SlugPopupInfo> = {};
  const slugToNetwork: Record<string, string> = {};
  const pageBySlug = new Map(allPages.map(p => [p.slug, p]));

  for (const p of allPages) {
    // Skip connectors — not listed, not standalone, no map presence.
    if (!p.listed && !p.standalone) continue;

    const isNetwork = (p.memberRefs?.length ?? 0) > 0;

    // Network pages: only register if standalone; never register their
    // aggregated geometry keys (members own those).
    if (isNetwork) {
      if (!p.standalone) continue;
      slugInfo[p.slug] = {
        name: pathName(p, locale),
        url: paths.bikePath(p.slug, p.memberOf, locale),
        length_km: p.length_km,
        surface: localizeSurface(p.surface, t, locale) || p.surface,
        path_type: localizePathType(p.path_type, t, locale),
        vibe: pathVibe(p, locale),
      };
      continue;
    }

    if (!p.standalone) continue;

    const netPage = p.memberOf ? pageBySlug.get(p.memberOf) : undefined;
    slugInfo[p.slug] = {
      name: pathName(p, locale),
      url: paths.bikePath(p.slug, p.memberOf, locale),
      length_km: p.length_km,
      surface: localizeSurface(p.surface, t, locale) || p.surface,
      path_type: localizePathType(p.path_type, t, locale),
      vibe: pathVibe(p, locale),
      network: netPage ? pathName(netPage, locale) : undefined,
      networkUrl: p.memberOf ? paths.bikePath(p.memberOf, undefined, locale) : undefined,
    };
    if (p.memberOf) slugToNetwork[p.slug] = p.memberOf;
  }

  return { slugInfo, slugToNetwork };
}

// ── GeoId aggregation (LD exclusion invariant) ───────────────────────

function stripGeoExt(file: string): string {
  return file.replace(/\.geojson$/, '');
}

/**
 * Build network → geoIds. Extracted long-distance members are excluded
 * from BOTH their parent network's aggregated geoFiles AND their own
 * member-page geoFiles, because those geo IDs now belong to the Trails
 * category and must not highlight as part of the parent network.
 */
export function buildNetworkGeoIds(
  networkPages: BikePathPage[],
  pageBySlug: Map<string, BikePathPage>,
  extractedLdSlugs: Set<string>,
): Record<string, string[]> {
  const result: Record<string, string[]> = {};

  for (const net of networkPages) {
    // Geo IDs owned by extracted members — exclude from the net's aggregate.
    const excludeGeoIds = new Set<string>();
    for (const m of net.memberRefs ?? []) {
      if (!extractedLdSlugs.has(m.slug)) continue;
      const memberPage = pageBySlug.get(m.slug);
      if (memberPage) {
        for (const gf of memberPage.geoFiles) excludeGeoIds.add(stripGeoExt(gf));
      }
    }

    const geoIds: string[] = [];
    for (const gf of net.geoFiles) {
      const id = stripGeoExt(gf);
      if (!excludeGeoIds.has(id)) geoIds.push(id);
    }
    for (const m of net.memberRefs ?? []) {
      if (extractedLdSlugs.has(m.slug)) continue;
      const memberPage = pageBySlug.get(m.slug);
      if (memberPage) {
        for (const gf of memberPage.geoFiles) geoIds.push(stripGeoExt(gf));
      }
    }
    result[net.slug] = geoIds;
  }

  return result;
}

/** Union of network + standalone geoIds per category tab. */
function buildCategoryGeoIds(
  categories: CategoryData[],
  networkGeoIds: Record<string, string[]>,
  pageBySlug: Map<string, BikePathPage>,
): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const cat of categories) {
    const allIds: string[] = [];
    for (const net of cat.networks) {
      const ids = networkGeoIds[net.slug] ?? [];
      allIds.push(...ids);
    }
    for (const sp of cat.standalonePaths) {
      const page = pageBySlug.get(sp.slug);
      if (page) {
        for (const gf of page.geoFiles) allIds.push(stripGeoExt(gf));
      }
    }
    result[cat.key] = allIds;
  }
  return result;
}

// ── Bounds aggregation ───────────────────────────────────────────────

/**
 * Precomputed bounds per network (build-time). The client uses these
 * directly for fitBounds, so tab hover doesn't need async tile loading.
 */
function buildNetworkBounds(
  networkPages: BikePathPage[],
  pageBySlug: Map<string, BikePathPage>,
  extractedLdSlugs: Set<string>,
): Record<string, Bounds> {
  const result: Record<string, Bounds> = {};
  for (const net of networkPages) {
    const allPoints: Array<{ lat: number; lng: number }> = [...net.points];
    for (const m of net.memberRefs ?? []) {
      if (extractedLdSlugs.has(m.slug)) continue;
      const memberPage = pageBySlug.get(m.slug);
      if (memberPage) allPoints.push(...memberPage.points);
    }
    const b = boundsFromPoints(allPoints);
    if (b) result[net.slug] = b;
  }
  return result;
}

/** Bounds for each category tab — union of its networks + standalone paths. */
function buildCategoryBounds(
  categories: CategoryData[],
  networkPages: BikePathPage[],
  pageBySlug: Map<string, BikePathPage>,
  extractedLdSlugs: Set<string>,
): Record<string, Bounds> {
  const networkPageBySlug = new Map(networkPages.map(n => [n.slug, n]));
  const result: Record<string, Bounds> = {};
  for (const cat of categories) {
    const allPoints: Array<{ lat: number; lng: number }> = [];
    for (const net of cat.networks) {
      const netPage = networkPageBySlug.get(net.slug);
      if (!netPage) continue;
      allPoints.push(...netPage.points);
      for (const m of netPage.memberRefs ?? []) {
        if (extractedLdSlugs.has(m.slug)) continue;
        const memberPage = pageBySlug.get(m.slug);
        if (memberPage) allPoints.push(...memberPage.points);
      }
    }
    for (const sp of cat.standalonePaths) {
      const page = pageBySlug.get(sp.slug);
      if (page) allPoints.push(...page.points);
    }
    const b = boundsFromPoints(allPoints);
    if (b) result[cat.key] = b;
  }
  return result;
}

// ── Entry point ──────────────────────────────────────────────────────

export function buildPathsIndexData(params: {
  allPages: BikePathPage[];
  locale: string | undefined;
  t: Translator;
}): PathsIndexData {
  const { allPages, locale, t } = params;
  const pageBySlug = new Map(allPages.map(p => [p.slug, p]));

  // Listed paths only (destination + infrastructure types), minimum 1 km.
  const listedPages = allPages.filter(p => p.listed && (!p.length_km || p.length_km >= 1));

  const networkPages = listedPages.filter(p => (p.memberRefs?.length ?? 0) > 0);
  const memberSlugs = new Set(networkPages.flatMap(n => (n.memberRefs ?? []).map(m => m.slug)));

  const allIndependent = listedPages
    .filter(p => p.standalone && !p.memberRefs && !memberSlugs.has(p.slug))
    .sort((a, b) => (b.length_km ?? 0) - (a.length_km ?? 0));

  const { byCategory: independentByCategory, uncategorized: initialUncategorized } =
    classifyIndependentPaths(allIndependent);

  // Partition members + build pure network infos (no side effects).
  const partitions = new Map<string, ReturnType<typeof partitionNetworkMembers>>();
  const longDistanceMemberRefs: MemberRef[] = [];
  for (const net of networkPages) {
    const p = partitionNetworkMembers(net);
    partitions.set(net.slug, p);
    longDistanceMemberRefs.push(...p.longDistanceMemberRefs);
  }

  // Classify networks by their members' dominant path_type and group.
  const categoryMap: Record<BrowseCategory, NetworkInfo[]> = {
    pathways: [],
    bikeways: [],
    local_trails: [],
    long_distance_trails: [],
    mtb: [],
  };
  for (const net of networkPages) {
    const cat = classifyNetworkForIndex(net, pageBySlug);
    const { localRefs } = partitions.get(net.slug)!;
    categoryMap[cat].push(buildNetworkInfo(net, localRefs, locale));
  }
  for (const nets of Object.values(categoryMap)) {
    nets.sort((a, b) => (b.length_km ?? 0) - (a.length_km ?? 0));
  }

  const { categories, uncategorized: uncategorizedPages } = assembleCategories({
    categoryMap,
    independentByCategory,
    initialUncategorized,
    longDistanceMemberRefs,
    pageBySlug,
    locale,
    t,
  });

  const uncategorized = uncategorizedPages.map(p => toStandalonePathInfo(p, locale, t));

  const extractedLdSlugs = new Set(longDistanceMemberRefs.map(m => m.slug));
  const networkGeoIds = buildNetworkGeoIds(networkPages, pageBySlug, extractedLdSlugs);
  const categoryGeoIds = buildCategoryGeoIds(categories, networkGeoIds, pageBySlug);
  const networkBounds = buildNetworkBounds(networkPages, pageBySlug, extractedLdSlugs);
  const categoryBounds = buildCategoryBounds(categories, networkPages, pageBySlug, extractedLdSlugs);

  const { slugInfo, slugToNetwork } = buildSlugPopupInfo(allPages, locale, t);

  return {
    categories,
    uncategorized,
    map: {
      networkGeoIds,
      categoryGeoIds,
      slugInfo,
      slugToNetwork,
      networkBounds,
      categoryBounds,
    },
    pathCount: listedPages.length,
  };
}

import { getCollection } from 'astro:content';
import type { CollectionEntry } from 'astro:content';
import homepageFactsByLocale from 'virtual:bike-app/homepage-facts';
import { isPublished } from './content/content-filters';
import { defaultLocale, shortLocale } from './i18n/locale-utils';
import { endOfDay, parseLocalDate } from './date-utils';
import { organizerLink, organizerInitials, hasDetailPage, isBikeShop } from './models/organizer-model';
import { toPlaceData } from './geo/places';
import { findNearbyPlaces } from './geo/proximity';
import type { PlaceData } from './geo/proximity';
import { getInstanceFeatures } from './config/instance-features';
import { paths } from './paths';
import { eventCoverKey } from './models/event-model';

type RouteEntry = CollectionEntry<'routes'>;
type EventEntry = CollectionEntry<'events'>;
type OrganizerEntry = CollectionEntry<'organizers'>;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FeaturedRoute {
  slug: string;
  localeSlug: string;
  name: string;
  distance_km: number;
  tagline?: string;
  description?: string;
  tags: string[];
  coverKey?: string;
  coverWidth?: number;
  coverHeight?: number;
  videoKey?: string;
  videoDuration?: string;
}

export interface UpcomingEvent {
  slug: string;
  name: string;
  startDate: string;
  endDate?: string;
  organizerName?: string;
  organizerSlug?: string;
  posterKey?: string;
}

export interface FeaturedCommunity {
  slug: string;
  name: string;
  initials: string;
  tagline?: string;
  photoKey?: string;
  link: string;
  eventCount: number;
  featured: boolean;
}

export interface ExploreMiniCard {
  slug: string;
  localeSlug: string;
  name: string;
  distance_km: number;
  tagline?: string;
  coverKey?: string;
  coverWidth?: number;
  coverHeight?: number;
}

export interface ResolvedFact {
  text: string;
  link?: string;
  link_text?: string;
}

export interface HomepageVideo {
  key: string;
  duration?: string;
  routeSlug: string;
  localeRouteSlug: string;
  routeName: string;
  caption?: string;
}

export interface MagazineData {
  featuredRoute: FeaturedRoute | null;
  upcomingEvents: UpcomingEvent[];
  featuredCommunities: FeaturedCommunity[];
  exploreRoutes: ExploreMiniCard[];
  facts: ResolvedFact[];
  video: HomepageVideo | null;
  routeCount: number;
}

// ---------------------------------------------------------------------------
// Deterministic daily pick — same day always returns same index
// ---------------------------------------------------------------------------

function dayOfYear(): number {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  return Math.floor((now.getTime() - start.getTime()) / 86400000);
}

function pickByDay<T>(items: T[]): T | null {
  if (items.length === 0) return null;
  return items[dayOfYear() % items.length];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getCover(route: RouteEntry) {
  const media = route.data.media ?? [];
  const cover = media.find(m => m.cover) ?? media.find(m => m.type === 'photo');
  return cover ?? null;
}

function getVideo(route: RouteEntry) {
  const media = route.data.media ?? [];
  return media.find(m => m.type === 'video') ?? null;
}

function getTrackPoints(route: RouteEntry) {
  const gpx = route.data.variants[0]?.gpx;
  const track = gpx ? route.data.gpxTracks[gpx] : null;
  return track?.points ?? [];
}

// ---------------------------------------------------------------------------
// Featured route — pick one per day at build time
// ---------------------------------------------------------------------------

const HTML_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00A0',
};

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&(?:#(\d+)|#x([0-9a-fA-F]+)|(\w+));/g, (_, dec, hex, named) => {
      if (dec) return String.fromCodePoint(Number(dec));
      if (hex) return String.fromCodePoint(parseInt(hex, 16));
      return HTML_ENTITIES[named] ?? '';
    })
    .replace(/\s+/g, ' ')
    .trim();
}

function getAllFeaturedRoutes(routes: RouteEntry[], locale?: string): FeaturedRoute[] {
  return routes
    .filter(r => r.data.homepage_featured)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(r => {
      const cover = getCover(r);
      const video = getVideo(r);
      const trans = locale ? r.data.translations?.[locale] : undefined;
      const body = stripHtml(trans?.renderedBody || r.data.renderedBody || '');
      const description = body.length > 200 ? body.slice(0, 200).replace(/\s\S*$/, '') + '\u2026' : body || undefined;
      return {
        slug: r.id,
        localeSlug: localeRouteSlug(r, locale),
        name: trans?.name || r.data.name,
        distance_km: r.data.distance_km,
        tagline: trans?.tagline || r.data.tagline,
        description,
        tags: r.data.tags ?? [],
        coverKey: cover?.key,
        coverWidth: cover?.width,
        coverHeight: cover?.height,
        videoKey: video?.key,
        videoDuration: video?.duration,
      };
    });
}


// ---------------------------------------------------------------------------
// Upcoming events (next 3)
// ---------------------------------------------------------------------------

function getUpcomingEvents(
  events: EventEntry[],
  organizers: OrganizerEntry[],
): UpcomingEvent[] {
  const now = new Date();
  const orgMap = new Map<string, OrganizerEntry>();
  for (const org of organizers) orgMap.set(org.id, org);

  return events
    .filter(e => {
      const endDate = e.data.end_date || e.data.start_date;
      return endOfDay(endDate) >= now;
    })
    .sort((a, b) => {
      const aDate = parseLocalDate(a.data.start_date).getTime();
      const bDate = parseLocalDate(b.data.start_date).getTime();
      return aDate - bDate;
    })
    .slice(0, 5)
    .map(e => {
      const orgId = typeof e.data.organizer === 'string' ? e.data.organizer : undefined;
      const org = orgId ? orgMap.get(orgId) : undefined;
      return {
        slug: e.id,
        name: e.data.name,
        startDate: e.data.start_date,
        endDate: e.data.end_date,
        organizerName: org?.data.name,
        organizerSlug: org?.id,
        posterKey: eventCoverKey(e.data),
      };
    });
}

// ---------------------------------------------------------------------------
// Featured communities (3 — featured first, then by event count)
// ---------------------------------------------------------------------------

function getFeaturedCommunities(
  organizers: OrganizerEntry[],
  events: EventEntry[],
  locale?: string,
): FeaturedCommunity[] {
  const eventCounts = new Map<string, number>();
  for (const event of events) {
    const orgId = typeof event.data.organizer === 'string' ? event.data.organizer : undefined;
    if (orgId) {
      eventCounts.set(orgId, (eventCounts.get(orgId) || 0) + 1);
    }
  }

  return organizers
    .filter(org => hasDetailPage(org) && !isBikeShop(org))
    .sort((a, b) => {
      if (a.data.featured && !b.data.featured) return -1;
      if (!a.data.featured && b.data.featured) return 1;
      return (eventCounts.get(b.id) || 0) - (eventCounts.get(a.id) || 0);
    })
    .map(org => ({
      slug: org.id,
      name: org.data.name,
      initials: organizerInitials(org.data.name),
      tagline: org.data.tagline,
      photoKey: org.data.photo_key,
      link: organizerLink(org, locale),
      eventCount: eventCounts.get(org.id) || 0,
      featured: !!org.data.featured,
    }));
}

// ---------------------------------------------------------------------------
// Routes to explore (3 non-featured)
// ---------------------------------------------------------------------------

function getExploreRoutes(
  routes: RouteEntry[],
  featuredSlugs: Set<string>,
  locale?: string,
): ExploreMiniCard[] {
  // Cap at 100 km — longer routes are for explorers who venture deeper into the site
  const candidates = routes.filter(r => !featuredSlugs.has(r.id) && r.data.distance_km <= 100);
  // Pick 3 spread across the distance range (shortest → longest)
  const sorted = [...candidates].sort((a, b) => a.data.distance_km - b.data.distance_km);
  const picked: RouteEntry[] = [];
  if (sorted.length <= 3) {
    picked.push(...sorted);
  } else {
    const step = (sorted.length - 1) / 2;
    picked.push(sorted[0], sorted[Math.round(step)], sorted[sorted.length - 1]);
  }
  return picked.map(r => {
    const cover = getCover(r);
    const trans = locale ? r.data.translations?.[locale] : undefined;
    return {
      slug: r.id,
      localeSlug: localeRouteSlug(r, locale),
      name: trans?.name || r.data.name,
      distance_km: r.data.distance_km,
      tagline: trans?.tagline || r.data.tagline,
      coverKey: cover?.key,
      coverWidth: cover?.width,
      coverHeight: cover?.height,
    };
  });
}

// ---------------------------------------------------------------------------
// Video: weighted daily rotation — featured route videos appear 2x
// ---------------------------------------------------------------------------

function findHomepageVideo(
  routes: RouteEntry[],
  featuredRoutes: FeaturedRoute[],
  locale?: string,
): HomepageVideo | null {
  const featuredSlugs = new Set(featuredRoutes.filter(r => r.videoKey).map(r => r.slug));
  const pool: HomepageVideo[] = [];

  // Add featured route videos (2x weight = add twice)
  // Featured routes already have locale-resolved names
  for (const fr of featuredRoutes) {
    if (fr.videoKey) {
      const entry: HomepageVideo = {
        key: fr.videoKey,
        duration: fr.videoDuration,
        routeSlug: fr.slug,
        localeRouteSlug: fr.localeSlug,
        routeName: fr.name,
      };
      pool.push(entry, entry);
    }
  }

  // Add non-featured route videos (1x weight)
  for (const route of routes.sort((a, b) => a.id.localeCompare(b.id))) {
    if (featuredSlugs.has(route.id)) continue;
    const video = getVideo(route);
    if (video) {
      const trans = locale ? route.data.translations?.[locale] : undefined;
      pool.push({
        key: video.key,
        duration: video.duration,
        routeSlug: route.id,
        localeRouteSlug: localeRouteSlug(route, locale),
        routeName: trans?.name || route.data.name,
        caption: video.caption,
      });
    }
  }

  return pickByDay(pool);
}

// ---------------------------------------------------------------------------
// DYK fact resolver
// ---------------------------------------------------------------------------

interface FactQuery {
  type: string;
  filter?: Record<string, string>;
  count_as?: string;
  sort?: string;
  order?: string;
  direction?: string; // alias for order
  pick?: string;
  fields?: string[];
  vibe?: string;
}

function resolveTemplate(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    const val = values[key];
    return val !== undefined ? String(val) : `{${key}}`;
  });
}

function routeName(route: RouteEntry, locale?: string): string {
  const trans = locale ? route.data.translations?.[shortLocale(locale)] : undefined;
  return trans?.name || route.data.name;
}

function localeRouteSlug(route: RouteEntry, locale?: string): string {
  if (locale) {
    const short = shortLocale(locale);
    const slug = route.data.translations?.[short]?.slug;
    if (typeof slug === 'string') return slug;
  }
  return route.id;
}

function resolveFactQuery(
  query: FactQuery,
  routes: RouteEntry[],
  placeData: PlaceData[],
  organizers: OrganizerEntry[],
  events: EventEntry[],
  locale?: string,
): Record<string, string | number> | null {
  const order = query.order || query.direction || 'asc';

  switch (query.type) {
    case 'places': {
      let filtered = placeData;
      if (query.filter) {
        for (const [key, value] of Object.entries(query.filter)) {
          filtered = filtered.filter(p => p[key as keyof PlaceData] === value);
        }
      }
      if (filtered.length === 0) return null;
      const result: Record<string, string | number> = {};
      if (query.count_as) result[query.count_as] = filtered.length;
      result.count = filtered.length;
      // Sample a place for name/link
      if (filtered.length > 0) {
        result.name = filtered[0].name;
      }
      return result;
    }

    case 'routes': {
      const published = routes.filter(isPublished);
      if (published.length === 0) return null;

      const sortField = query.sort || 'distance_km';
      const sorted = [...published].sort((a, b) => {
        const aVal = (a.data as Record<string, unknown>)[sortField];
        const bVal = (b.data as Record<string, unknown>)[sortField];
        const diff = (Number(aVal) || 0) - (Number(bVal) || 0);
        return order === 'desc' ? -diff : diff;
      });

      const picked = query.pick === 'last' ? sorted[sorted.length - 1] : sorted[0];
      if (!picked) return null;

      return {
        name: routeName(picked, locale),
        slug: picked.id,
        distance_km: picked.data.distance_km,
        count: published.length,
      };
    }

    case 'organizers': {
      if (organizers.length === 0) return null;
      // Compute event counts
      const eventCounts = new Map<string, number>();
      for (const event of events) {
        const orgId = typeof event.data.organizer === 'string' ? event.data.organizer : undefined;
        if (orgId) eventCounts.set(orgId, (eventCounts.get(orgId) || 0) + 1);
      }
      const sorted = [...organizers].sort((a, b) => {
        const diff = (eventCounts.get(a.id) || 0) - (eventCounts.get(b.id) || 0);
        return order === 'desc' ? -diff : diff;
      });
      const picked = query.pick === 'last' ? sorted[sorted.length - 1] : sorted[0];
      if (!picked) return null;
      return {
        name: picked.data.name,
        slug: picked.id,
        event_count: eventCounts.get(picked.id) || 0,
        count: organizers.length,
      };
    }

    case 'aggregate': {
      const result: Record<string, string | number> = {};
      result.route_count = routes.filter(isPublished).length;
      result.place_count = placeData.length;
      result.organizer_count = organizers.length;
      result.event_count = events.length;
      const totalKm = routes.filter(isPublished).reduce((sum, r) => sum + r.data.distance_km, 0);
      result.total_km = Math.round(totalKm);
      return result;
    }

    case 'routes_near_places': {
      // Find routes that pass near places matching a filter
      let matchingPlaces = placeData;
      if (query.filter) {
        for (const [key, value] of Object.entries(query.filter)) {
          matchingPlaces = matchingPlaces.filter(p => p[key as keyof PlaceData] === value);
        }
      }
      if (matchingPlaces.length === 0) return null;

      const published = routes.filter(isPublished);
      let routeCount = 0;
      for (const route of published) {
        const points = getTrackPoints(route);
        if (points.length < 2) continue;
        const nearby = findNearbyPlaces(points, matchingPlaces);
        if (nearby.length > 0) routeCount++;
      }
      if (routeCount === 0) return null;
      return { count: routeCount, place_count: matchingPlaces.length };
    }

    case 'route_place_density': {
      // Route with the most matching places per km
      let matchingPlaces = placeData;
      if (query.filter) {
        for (const [key, value] of Object.entries(query.filter)) {
          matchingPlaces = matchingPlaces.filter(p => p[key as keyof PlaceData] === value);
        }
      }
      if (matchingPlaces.length === 0) return null;

      const published = routes.filter(isPublished);
      let bestRoute: RouteEntry | null = null;
      let bestDensity = 0;
      let bestCount = 0;

      for (const route of published) {
        const points = getTrackPoints(route);
        if (points.length < 2) continue;
        const nearby = findNearbyPlaces(points, matchingPlaces);
        const density = nearby.length / route.data.distance_km;
        if (density > bestDensity) {
          bestDensity = density;
          bestRoute = route;
          bestCount = nearby.length;
        }
      }
      if (!bestRoute) return null;
      return {
        name: routeName(bestRoute, locale),
        slug: bestRoute.id,
        count: bestCount,
        distance_km: bestRoute.data.distance_km,
      };
    }

    case 'route_places': {
      // Places along routes, optional vibe text
      let matchingPlaces = placeData;
      if (query.filter) {
        for (const [key, value] of Object.entries(query.filter)) {
          matchingPlaces = matchingPlaces.filter(p => p[key as keyof PlaceData] === value);
        }
      }
      if (matchingPlaces.length === 0) return null;

      // Count total places near all routes
      const published = routes.filter(isPublished);
      const allNearby = new Set<string>();
      for (const route of published) {
        const points = getTrackPoints(route);
        if (points.length < 2) continue;
        const nearby = findNearbyPlaces(points, matchingPlaces);
        for (const p of nearby) allNearby.add(p.id);
      }
      if (allNearby.size === 0) return null;
      return { count: allNearby.size };
    }

    default:
      return null;
  }
}

export function resolveHomepageFacts(
  routes: RouteEntry[],
  placeData: PlaceData[],
  organizers: OrganizerEntry[],
  events: EventEntry[],
  locale?: string,
): ResolvedFact[] {
  const short = locale ? shortLocale(locale) : defaultLocale();
  const homepageFactEntries = homepageFactsByLocale[short] ?? homepageFactsByLocale[defaultLocale()] ?? [];
  if (homepageFactEntries.length === 0) return [];

  // Build a slug map for locale-aware route links
  const routeBySlug = new Map<string, RouteEntry>();
  for (const r of routes) routeBySlug.set(r.id, r);

  const resolved: ResolvedFact[] = [];

  for (const fact of homepageFactEntries) {
    // Pre-resolved text — always valid
    if (fact.text) {
      resolved.push({ text: fact.text, link: fact.link, link_text: fact.link_text });
      continue;
    }

    // Hand-written template without query — always valid
    if (fact.template && !fact.query) {
      resolved.push({ text: fact.template, link: fact.link, link_text: fact.link_text });
      continue;
    }

    // Template with query — resolve values
    if (fact.template && fact.query) {
      const values = resolveFactQuery(fact.query, routes, placeData, organizers, events, locale);
      if (!values) continue; // skip facts with zero results

      const text = resolveTemplate(fact.template, values);
      let link = fact.link;
      if (fact.link_from && values[fact.link_from]) {
        const slug = String(values[fact.link_from]);
        const route = routeBySlug.get(slug);
        const trans = route?.data.translations?.[short];
        const localeSlug = (trans && typeof trans.slug === 'string' ? trans.slug : null) || slug;
        link = paths.route(localeSlug, locale);
      }
      const link_text = fact.link_text ? resolveTemplate(fact.link_text, values) : undefined;
      resolved.push({ text, link, link_text });
    }
  }

  return resolved;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function loadMagazineData(locale?: string): Promise<MagazineData> {
  const features = getInstanceFeatures();

  const routes = features.hasRoutes ? (await getCollection('routes')).filter(isPublished) : [];
  const events = features.hasEvents ? await getCollection('events') : [];
  const organizers = features.hasEvents ? await getCollection('organizers') : [];
  const allPlaces = features.hasPlaces ? await getCollection('places') : [];
  const placeData = toPlaceData(allPlaces);

  const allFeatured = getAllFeaturedRoutes(routes, locale);
  const featuredRoute = pickByDay(allFeatured);
  const upcomingEvents = getUpcomingEvents(events, organizers);
  const featuredCommunities = getFeaturedCommunities(organizers, events, locale);

  const todayFeaturedSlug = new Set(featuredRoute ? [featuredRoute.slug] : []);
  const exploreRoutes = getExploreRoutes(routes, todayFeaturedSlug, locale);

  const facts = resolveHomepageFacts(routes, placeData, organizers, events, locale);
  const video = findHomepageVideo(routes, allFeatured, locale);

  return {
    featuredRoute,
    upcomingEvents,
    featuredCommunities,
    exploreRoutes,
    facts,
    video,
    routeCount: routes.length,
  };
}

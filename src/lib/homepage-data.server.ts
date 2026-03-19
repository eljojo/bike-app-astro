import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { getCollection } from 'astro:content';
import type { CollectionEntry } from 'astro:content';
import { isPublished } from './content/content-filters';
import { endOfDay, parseLocalDate } from './date-utils';
import { organizerLink } from './models/organizer-model';
import { toPlaceData } from './geo/places';
import { findNearbyPlaces } from './geo/proximity';
import type { PlaceData } from './geo/proximity';
import { cityDir } from './config/config.server';
import { getInstanceFeatures } from './config/instance-features';
import { paths } from './paths';

type RouteEntry = CollectionEntry<'routes'>;
type EventEntry = CollectionEntry<'events'>;
type OrganizerEntry = CollectionEntry<'organizers'>;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FeaturedRoute {
  slug: string;
  name: string;
  distance_km: number;
  tagline?: string;
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
}

export interface FeaturedCommunity {
  slug: string;
  name: string;
  tagline?: string;
  photoKey?: string;
  link: string;
  eventCount: number;
}

export interface ExploreMiniCard {
  slug: string;
  name: string;
  distance_km: number;
  coverKey?: string;
  coverWidth?: number;
  coverHeight?: number;
}

export interface ResolvedFact {
  text: string;
  link?: string;
}

export interface HomepageVideo {
  key: string;
  duration?: string;
  routeSlug: string;
  routeName: string;
  caption?: string;
}

export interface MagazineData {
  featuredRoutes: FeaturedRoute[];
  upcomingEvents: UpcomingEvent[];
  featuredCommunities: FeaturedCommunity[];
  exploreRoutes: ExploreMiniCard[];
  facts: ResolvedFact[];
  video: HomepageVideo | null;
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
// Featured routes (all — client rotates daily)
// ---------------------------------------------------------------------------

function getFeaturedRoutes(routes: RouteEntry[]): FeaturedRoute[] {
  return routes
    .filter(r => r.data.homepage_featured)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(r => {
      const cover = getCover(r);
      const video = getVideo(r);
      return {
        slug: r.id,
        name: r.data.name,
        distance_km: r.data.distance_km,
        tagline: r.data.tagline,
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
    .slice(0, 3)
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

  return [...organizers]
    .sort((a, b) => {
      if (a.data.featured && !b.data.featured) return -1;
      if (!a.data.featured && b.data.featured) return 1;
      return (eventCounts.get(b.id) || 0) - (eventCounts.get(a.id) || 0);
    })
    .slice(0, 3)
    .map(org => ({
      slug: org.id,
      name: org.data.name,
      tagline: org.data.tagline,
      photoKey: org.data.photo_key,
      link: organizerLink(org, locale),
      eventCount: eventCounts.get(org.id) || 0,
    }));
}

// ---------------------------------------------------------------------------
// Routes to explore (3 non-featured)
// ---------------------------------------------------------------------------

function getExploreRoutes(
  routes: RouteEntry[],
  featuredSlugs: Set<string>,
): ExploreMiniCard[] {
  const candidates = routes.filter(r => !featuredSlugs.has(r.id));
  // Pick 3 spread across the distance range
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
    return {
      slug: r.id,
      name: r.data.name,
      distance_km: r.data.distance_km,
      coverKey: cover?.key,
      coverWidth: cover?.width,
      coverHeight: cover?.height,
    };
  });
}

// ---------------------------------------------------------------------------
// Video: find one from featured routes, or any route
// ---------------------------------------------------------------------------

function findHomepageVideo(
  routes: RouteEntry[],
  featuredRoutes: FeaturedRoute[],
): HomepageVideo | null {
  // Prefer video from featured route
  for (const fr of featuredRoutes) {
    if (fr.videoKey) {
      return {
        key: fr.videoKey,
        duration: fr.videoDuration,
        routeSlug: fr.slug,
        routeName: fr.name,
      };
    }
  }
  // Fall back to any route with a video
  for (const route of routes) {
    const video = getVideo(route);
    if (video) {
      return {
        key: video.key,
        duration: video.duration,
        routeSlug: route.id,
        routeName: route.data.name,
        caption: video.caption,
      };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// DYK fact resolver
// ---------------------------------------------------------------------------

interface FactEntry {
  template?: string;
  text?: string;
  link?: string;
  link_from?: string;
  query?: FactQuery;
}

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

interface FactsFile {
  facts: FactEntry[];
}

function resolveTemplate(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    const val = values[key];
    return val !== undefined ? String(val) : `{${key}}`;
  });
}

function resolveFactQuery(
  query: FactQuery,
  routes: RouteEntry[],
  placeData: PlaceData[],
  organizers: OrganizerEntry[],
  events: EventEntry[],
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
        name: picked.data.name,
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
        name: bestRoute.data.name,
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
): ResolvedFact[] {
  const factsPath = path.join(cityDir, 'homepage-facts.yml');
  if (!fs.existsSync(factsPath)) return [];

  const raw = fs.readFileSync(factsPath, 'utf-8');
  const parsed = yaml.load(raw) as FactsFile | null;
  if (!parsed?.facts) return [];

  const resolved: ResolvedFact[] = [];

  for (const fact of parsed.facts) {
    // Pre-resolved text — always valid
    if (fact.text) {
      resolved.push({ text: fact.text, link: fact.link });
      continue;
    }

    // Hand-written template without query — always valid
    if (fact.template && !fact.query) {
      resolved.push({ text: fact.template, link: fact.link });
      continue;
    }

    // Template with query — resolve values
    if (fact.template && fact.query) {
      const values = resolveFactQuery(fact.query, routes, placeData, organizers, events);
      if (!values) continue; // skip facts with zero results

      const text = resolveTemplate(fact.template, values);
      let link = fact.link;
      if (fact.link_from && values[fact.link_from]) {
        link = paths.route(String(values[fact.link_from]));
      }
      resolved.push({ text, link });
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

  const featuredRoutes = getFeaturedRoutes(routes);
  const upcomingEvents = getUpcomingEvents(events, organizers);
  const featuredCommunities = getFeaturedCommunities(organizers, events, locale);

  const featuredSlugs = new Set(featuredRoutes.map(r => r.slug));
  const exploreRoutes = getExploreRoutes(routes, featuredSlugs);

  const facts = resolveHomepageFacts(routes, placeData, organizers, events);
  const video = findHomepageVideo(routes, featuredRoutes);

  return {
    featuredRoutes,
    upcomingEvents,
    featuredCommunities,
    exploreRoutes,
    facts,
    video,
  };
}

/** Build-time constant: true when RUNTIME=local (Node.js adapter). */
declare const __RUNTIME_LOCAL__: boolean;

/** Build-time constant: true unless ENABLE_BIKE_PATHS=false. Gates bike-path pages, sitemap, nav, map layer. */
declare const __ENABLE_BIKE_PATHS__: boolean;

/**
 * Ambient module declarations for Vite virtual modules.
 *
 * This must be in a file with NO top-level imports/exports so TypeScript
 * treats it as an ambient declaration (creating the module) rather than
 * module augmentation.
 *
 * Canonical types: src/lib/models/route-model.ts (RouteDetail)
 * Canonical types: src/lib/models/event-model.ts (EventDetail)
 */

/**
 * Interfaces use underscore prefixes (e.g., _AdminRoute, _Tour) to avoid
 * collisions with identically named types in application code. This file is
 * ambient (no top-level imports/exports), so all names are globally visible.
 */
/**
 * Admin route list item. On blog instances, the admin-routes module serves
 * ride data instead — ride-specific fields are marked optional so both
 * shapes satisfy this type.
 */
interface _AdminRoute {
  slug: string;
  name: string;
  status: string;
  contentHash?: string;
  // Route-specific (wiki)
  mediaCount?: number;
  difficultyScore?: number | null;
  coverKey?: string;
  // Ride-specific (blog)
  date?: string;
  distance_km?: number;
  elevation_m?: number;
  country?: string;
  tour_slug?: string;
  highlight?: boolean;
}

/**
 * Admin route detail. On blog instances, the admin-route-detail module serves
 * ride details — ride-specific fields are marked optional.
 */
type _AdminRouteDetail = import('./lib/models/route-model').RouteDetail & {
  contentHash?: string;
  // Ride-specific (blog) — present when admin-route-detail serves ride data
  ride_date?: string;
  country?: string;
  tour_slug?: string;
  highlight?: boolean;
  elapsed_time_s?: number;
  moving_time_s?: number;
  average_speed_kmh?: number;
  gpxRelativePath?: string;
};

type _AdminEvent = import('./types/admin').AdminEvent;

type _AdminEventDetail = import('./lib/models/event-model').EventDetail & { contentHash: string };

type _AdminOrganizer = import('./types/admin').AdminOrganizer;

declare module 'virtual:bike-app/admin-routes' {
  const routes: _AdminRoute[];
  export default routes;
}

declare module 'virtual:bike-app/admin-route-detail' {
  const details: Record<string, _AdminRouteDetail>;
  export default details;
}

declare module 'virtual:bike-app/admin-events' {
  const events: _AdminEvent[];
  export default events;
}

declare module 'virtual:bike-app/admin-event-detail' {
  const details: Record<string, _AdminEventDetail>;
  export default details;
}

type _AdminPlace = import('./types/admin').AdminPlace;

type _AdminPlaceDetail = import('./lib/models/place-model').PlaceDetail & { contentHash?: string };

declare module 'virtual:bike-app/admin-places' {
  const places: _AdminPlace[];
  export default places;
}

declare module 'virtual:bike-app/admin-place-detail' {
  const details: Record<string, _AdminPlaceDetail>;
  export default details;
}

interface _AdminBikePath {
  id: string;
  name: string;
  vibe?: string;
  hidden: boolean;
  stub: boolean;
  hasGeometry: boolean;
  includes: string[];
  tags: string[];
  contentHash: string;
}

interface _AdminBikePathDetail {
  id: string;
  name?: string;
  vibe?: string;
  hidden: boolean;
  stub: boolean;
  featured: boolean;
  includes: string[];
  photo_key?: string;
  tags: string[];
  body: string;
  contentHash?: string;
  /** Dynamic locale name keys like name_fr, name_es etc. */
  [key: `name_${string}`]: string | undefined;
}

declare module 'virtual:bike-app/admin-bike-paths' {
  const bikePaths: _AdminBikePath[];
  export default bikePaths;
}

declare module 'virtual:bike-app/admin-bike-path-detail' {
  const details: Record<string, _AdminBikePathDetail>;
  export default details;
}

declare module 'virtual:bike-app/admin-organizers' {
  const organizers: _AdminOrganizer[];
  export default organizers;
}

declare module 'virtual:bike-app/admin-organizer-detail' {
  const data: Record<string, import('./lib/models/organizer-model').OrganizerDetail>;
  export default data;
}

interface _Contributor {
  username: string;
  gravatarHash: string;
}

declare module 'virtual:bike-app/contributors' {
  const contributors: _Contributor[];
  export default contributors;
}

interface _MediaLocation {
  key: string;
  lat: number;
  lng: number;
  routeSlug: string;
  caption?: string;
  width?: number;
  height?: number;
  type?: 'photo' | 'video';
}

declare module 'virtual:bike-app/media-locations' {
  const locations: _MediaLocation[];
  export default locations;
}

declare module 'virtual:bike-app/nearby-media' {
  const nearbyMedia: Record<string, _MediaLocation[]>;
  export default nearbyMedia;
}

interface _ParkedMedia {
  key: string;
  lat: number;
  lng: number;
  caption?: string;
  width?: number;
  height?: number;
  uploaded_by?: string;
  captured_at?: string;
  type?: 'photo' | 'video';
  title?: string;
  handle?: string;
  duration?: string;
  orientation?: string;
}

declare module 'virtual:bike-app/parked-media' {
  const parkedMedia: _ParkedMedia[];
  export default parkedMedia;
}

declare module 'virtual:bike-app/media-shared-keys' {
  /** Only contains keys referenced by 2+ content items */
  const sharedKeys: Record<string, Array<{ type: 'route' | 'place' | 'event' | 'parked'; slug: string }>>;
  export default sharedKeys;
}

interface _Tour {
  slug: string;
  name: string;
  description?: string;
  renderedDescription?: string;
  total_distance_km: number;
  total_elevation_m: number;
  days: number;
  ride_count: number;
  countries: string[];
  start_date: string;
  end_date: string;
  rides: string[];
  gpxHash?: string;
}

declare module 'virtual:bike-app/tours' {
  const tours: _Tour[];
  export default tours;
}

interface _RideStats {
  total_distance_km: number;
  total_elevation_m: number;
  total_rides: number;
  total_tours: number;
  total_days: number;
  countries: string[];
  by_year: Record<string, { rides: number; distance_km: number; elevation_m: number }>;
  by_country: Record<string, { rides: number; distance_km: number }>;
  records: {
    longest_ride?: { slug: string; name: string; distance_km: number; tour_slug?: string };
    most_elevation?: { slug: string; name: string; elevation_m: number; tour_slug?: string };
    longest_tour?: { slug: string; name: string; distance_km: number; days: number };
  };
}

declare module 'virtual:bike-app/ride-stats' {
  const stats: _RideStats;
  export default stats;
}

declare module 'virtual:bike-app/ride-redirects' {
  /** Map of source path → target path for ride 301 redirects */
  const redirects: Record<string, string>;
  export default redirects;
}

declare module 'virtual:bike-app/route-redirects' {
  /** Map of old route slug → canonical slug from redirects.yml routes section */
  const redirects: Record<string, string>;
  export default redirects;
}

declare module 'virtual:bike-app/content-redirects' {
  /** Map of source path → target path for content 301 redirects (routes, guides, videos, tours, short_urls) */
  const redirects: Record<string, string>;
  export default redirects;
}

declare module 'virtual:bike-app/video-route-map' {
  /** Map of video handle → route slug (from each route's media.yml) */
  const map: Record<string, string>;
  export default map;
}

interface _HomepageFact {
  template?: string;
  text?: string;
  link?: string;
  link_text?: string;
  always?: boolean;
  link_from?: string;
  query?: {
    type: string;
    filter?: Record<string, string>;
    count_as?: string;
    sort?: string;
    order?: string;
    direction?: string;
    pick?: string;
    fields?: string[];
    vibe?: string;
  };
}

declare module 'virtual:bike-app/homepage-facts' {
  const facts: Record<string, _HomepageFact[]>;
  export default facts;
}

declare module 'virtual:bike-app/bike-path-pages' {
  const pages: import('./lib/bike-paths/bike-path-entries.server').BikePathPage[];
  const allYmlEntries: import('./lib/bike-paths/bikepaths-yml.server').SluggedBikePathYml[];
  const geoFiles: string[];
  const routeToPaths: Record<string, Array<{ slug: string; name: string; surface?: string }>>;
  export { pages, allYmlEntries, geoFiles, routeToPaths };
}

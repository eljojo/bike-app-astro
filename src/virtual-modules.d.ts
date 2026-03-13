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
  difficultyScore?: number;
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
interface _AdminRouteDetail {
  slug: string;
  name: string;
  tagline: string;
  tags: string[];
  status: string;
  body: string;
  media: Array<{ key: string; caption?: string; cover?: boolean; width?: number; height?: number; lat?: number; lng?: number; uploaded_by?: string; captured_at?: string }>;
  contentHash?: string;
  variants?: Array<{ name: string; gpx: string; distance_km?: number; strava_url?: string; rwgps_url?: string; komoot_url?: string }>;
  // Ride-specific (blog)
  ride_date?: string;
  country?: string;
  tour_slug?: string;
  highlight?: boolean;
  elapsed_time_s?: number;
  moving_time_s?: number;
  average_speed_kmh?: number;
  gpxRelativePath?: string;
}

interface _AdminEvent {
  id: string;
  slug: string;
  year: string;
  name: string;
  start_date: string;
  end_date?: string;
  status?: string;
  routes?: string[];
  organizer?: string | { name: string; website?: string; instagram?: string };
  poster_key?: string;
  mediaCount: number;
  waypointCount: number;
  contentHash: string;
}

/** Mirrors EventDetail from src/lib/models/event-model.ts + contentHash */
interface _AdminEventDetail {
  id: string;
  slug: string;
  year: string;
  name: string;
  start_date: string;
  event_date?: string;
  start_time?: string;
  end_date?: string;
  end_time?: string;
  time_limit_hours?: number;
  status?: string;
  routes?: string[];
  registration?: {
    url?: string;
    slots?: number;
    price?: string;
    deadline?: string;
    departure_groups?: string[];
  };
  registration_url?: string;
  waypoints?: Array<{
    place: string;
    type: 'checkpoint' | 'danger' | 'poi';
    label: string;
    distance_km?: number;
    opening?: string;
    closing?: string;
    route?: string;
  }>;
  results?: Array<{
    brevet_no?: number;
    last_name: string;
    first_name?: string;
    time?: string;
    homologation?: string;
    status?: 'DNS' | 'DNF' | 'DQ';
  }>;
  gpx_include_waypoints?: boolean;
  distances?: string;
  location?: string;
  review_url?: string;
  organizer?: string | { name: string; website?: string; instagram?: string };
  poster_key?: string;
  poster_content_type?: string;
  body: string;
  media?: Array<{
    key: string;
    caption?: string;
    cover?: boolean;
    width?: number;
    height?: number;
    lat?: number;
    lng?: number;
    type?: string;
  }>;
  contentHash?: string;
}

interface _AdminOrganizer {
  slug: string;
  name: string;
  website?: string;
  instagram?: string;
}

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

interface _AdminPlace {
  id: string;
  name: string;
  category: string;
  lat: number;
  lng: number;
  contentHash: string;
}

/** Mirrors PlaceDetail from src/lib/models/place-model.ts + contentHash */
interface _AdminPlaceDetail {
  id: string;
  name: string;
  name_fr?: string;
  category: string;
  lat: number;
  lng: number;
  status?: string;
  address?: string;
  website?: string;
  phone?: string;
  google_maps_url?: string;
  photo_key?: string;
  contentHash?: string;
}

declare module 'virtual:bike-app/admin-places' {
  const places: _AdminPlace[];
  export default places;
}

declare module 'virtual:bike-app/admin-place-detail' {
  const details: Record<string, _AdminPlaceDetail>;
  export default details;
}

declare module 'virtual:bike-app/admin-organizers' {
  const organizers: _AdminOrganizer[];
  export default organizers;
}

interface _Contributor {
  username: string;
  gravatarHash: string;
}

declare module 'virtual:bike-app/contributors' {
  const contributors: _Contributor[];
  export default contributors;
}

interface _PhotoLocation {
  key: string;
  lat: number;
  lng: number;
  routeSlug: string;
  caption?: string;
  width?: number;
  height?: number;
}

declare module 'virtual:bike-app/photo-locations' {
  const locations: _PhotoLocation[];
  export default locations;
}

declare module 'virtual:bike-app/nearby-photos' {
  const nearbyPhotos: Record<string, _PhotoLocation[]>;
  export default nearbyPhotos;
}

interface _ParkedPhoto {
  key: string;
  lat: number;
  lng: number;
  caption?: string;
  width?: number;
  height?: number;
  uploaded_by?: string;
  captured_at?: string;
}

declare module 'virtual:bike-app/parked-photos' {
  const parkedPhotos: _ParkedPhoto[];
  export default parkedPhotos;
}

declare module 'virtual:bike-app/photo-shared-keys' {
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
    longest_ride?: { slug: string; name: string; distance_km: number };
    most_elevation?: { slug: string; name: string; elevation_m: number };
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

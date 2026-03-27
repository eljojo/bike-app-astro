// Detail types (RouteDetail, EventDetail, AdminMediaItem, AdminVariant) are
// canonical in src/lib/models/route-model.ts and src/lib/models/event-model.ts

export interface AdminRoute {
  slug: string;
  name: string;
  mediaCount: number;
  status: string;
  contentHash: string;
  difficultyScore: number | null;
  coverKey?: string;
}

export interface AdminEvent {
  id: string;
  slug: string;
  year: string;
  name: string;
  start_date: string;
  end_date?: string;
  status?: string;
  routes?: string[];
  organizer?: string | { name: string; website?: string; instagram?: string; photo_key?: string; photo_content_type?: string; photo_width?: number; photo_height?: number };
  poster_key?: string;
  poster_width?: number;
  poster_height?: number;
  tags?: string[];
  previous_event?: string;
  edition?: string;
  event_url?: string;
  map_url?: string;
  is_series?: boolean;
  meet_time?: string;
  series_label?: string;
  mediaCount: number;
  waypointCount: number;
  contentHash: string;
}

export interface AdminPlace {
  id: string;
  name: string;
  category: string;
  lat: number;
  lng: number;
  vibe?: string;
  good_for: string[];
  contentHash: string;
}

export interface AdminOrganizer {
  slug: string;
  name: string;
  tagline?: string;
  tags: string[];
  featured: boolean;
  website?: string;
  instagram?: string;
  photo_key?: string;
  photo_content_type?: string;
  photo_width?: number;
  photo_height?: number;
  contentHash: string;
}

export interface AdminBikePath {
  id: string;
  name: string;
  vibe?: string;
  hidden: boolean;
  includes: string[];
  tags: string[];
  contentHash: string;
}

/** Minimal route reference used by event editors. */
export interface RouteOption {
  slug: string;
  name: string;
}

export interface AdminRide {
  slug: string;
  name: string;
  date: string;
  distance_km: number;
  elevation_m: number;
  country?: string;
  tour_slug?: string;
  highlight?: boolean;
  contentHash: string;
}

/** Tour summary used by ride editor and tour picker. */
export interface TourSummary {
  slug: string;
  name: string;
  start_date?: string;
  end_date?: string;
  ride_count?: number;
}

export interface AdminOrganizerRef {
  name: string;
  website?: string;
  instagram?: string;
}

export interface AdminMediaItem {
  key: string;
  caption?: string;
  cover?: boolean;
  width?: number;
  height?: number;
}

export interface AdminVariant {
  name: string;
  gpx: string;
  distance_km?: number;
  strava_url?: string;
  rwgps_url?: string;
}

export interface AdminRoute {
  slug: string;
  name: string;
  mediaCount: number;
  status: string;
  contentHash: string;
  difficultyScore: number | null;
}

export interface AdminRouteDetail {
  slug: string;
  name: string;
  tagline: string;
  tags: string[];
  status: string;
  body: string;
  media: AdminMediaItem[];
  contentHash: string;
  variants: AdminVariant[];
}

export interface AdminEvent {
  id: string;
  slug: string;
  year: string;
  name: string;
  start_date: string;
  end_date?: string;
  organizer?: string | AdminOrganizerRef;
  poster_key?: string;
  contentHash: string;
}

export interface AdminEventDetail {
  id: string;
  slug: string;
  year: string;
  name: string;
  start_date: string;
  start_time?: string;
  end_date?: string;
  end_time?: string;
  registration_url?: string;
  distances?: string;
  location?: string;
  review_url?: string;
  organizer?: string | AdminOrganizerRef;
  poster_key?: string;
  poster_content_type?: string;
  body: string;
  contentHash: string;
}

export interface AdminOrganizer {
  slug: string;
  name: string;
  website?: string;
  instagram?: string;
}

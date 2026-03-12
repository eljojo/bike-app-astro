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
  organizer?: string | { name: string; website?: string; instagram?: string };
  poster_key?: string;
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
  contentHash: string;
}

export interface AdminOrganizer {
  slug: string;
  name: string;
  website?: string;
  instagram?: string;
}

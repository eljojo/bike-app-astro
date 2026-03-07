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

interface _AdminRoute {
  slug: string;
  name: string;
  mediaCount: number;
  status: string;
  contentHash?: string;
  difficultyScore?: number;
}

/** Mirrors RouteDetail from src/lib/models/route-model.ts + contentHash */
interface _AdminRouteDetail {
  slug: string;
  name: string;
  tagline: string;
  tags: string[];
  status: string;
  body: string;
  media: Array<{ key: string; caption?: string; cover?: boolean; width?: number; height?: number; lat?: number; lng?: number; uploaded_by?: string }>;
  contentHash?: string;
  variants?: Array<{ name: string; gpx: string; distance_km?: number; strava_url?: string; rwgps_url?: string }>;
}

interface _AdminEvent {
  id: string;
  slug: string;
  year: string;
  name: string;
  start_date: string;
  end_date?: string;
  organizer?: string | { name: string; website?: string; instagram?: string };
  poster_key?: string;
  contentHash: string;
}

/** Mirrors EventDetail from src/lib/models/event-model.ts + contentHash */
interface _AdminEventDetail {
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
  organizer?: string | { name: string; website?: string; instagram?: string };
  poster_key?: string;
  poster_content_type?: string;
  body: string;
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

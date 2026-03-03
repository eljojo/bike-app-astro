/// <reference types="astro/client" />

import type { SessionUser } from './lib/auth';

declare namespace App {
  interface Locals {
    user?: SessionUser;
  }
}

// Type the cloudflare:workers env bindings
declare module 'cloudflare:workers' {
  interface Env {
    DB: D1Database;
    BUCKET: R2Bucket;
    ASSETS: Fetcher;
    GITHUB_TOKEN: string;
    WEBAUTHN_RP_ID: string;
    WEBAUTHN_RP_NAME: string;
    WEBAUTHN_ORIGIN: string;
    R2_ACCESS_KEY_ID: string;
    R2_SECRET_ACCESS_KEY: string;
    R2_ACCOUNT_ID: string;
    R2_BUCKET_NAME: string;
    R2_PUBLIC_URL: string;
    STORAGE_KEY_PREFIX?: string;
    GIT_BRANCH?: string;
    ENVIRONMENT?: string;
  }
}

// Virtual modules provided by buildDataPlugin
declare module 'virtual:bike-app/admin-routes' {
  const routes: Array<{
    slug: string;
    name: string;
    photoCount: number;
    status: string;
    contentHash: string;
    difficultyScore: number | null;
  }>;
  export default routes;
}

declare module 'virtual:bike-app/admin-route-detail' {
  interface AdminMediaItem {
    key: string;
    caption?: string;
    cover?: boolean;
  }
  interface AdminVariant {
    name: string;
    gpx: string;
    distance_km?: number;
    strava_url?: string;
    rwgps_url?: string;
  }
  interface AdminRouteDetail {
    slug: string;
    name: string;
    tagline: string;
    tags: string[];
    distance: number;
    status: string;
    body: string;
    media: AdminMediaItem[];
    contentHash: string;
    variants: AdminVariant[];
  }
  const details: Record<string, AdminRouteDetail>;
  export default details;
}

declare module 'virtual:bike-app/admin-events' {
  interface OrganizerInline { name: string; website?: string; instagram?: string }
  const events: Array<{
    id: string; slug: string; year: string; name: string;
    start_date: string; end_date?: string;
    organizer?: string | OrganizerInline;
    poster_key?: string; contentHash: string;
  }>;
  export default events;
}

declare module 'virtual:bike-app/admin-event-detail' {
  interface OrganizerInline { name: string; website?: string; instagram?: string }
  const details: Record<string, {
    id: string; slug: string; year: string; name: string;
    start_date: string; start_time?: string; end_date?: string; end_time?: string;
    registration_url?: string; distances?: string; location?: string;
    review_url?: string;
    organizer?: string | OrganizerInline;
    poster_key?: string; poster_content_type?: string; body: string; contentHash: string;
  }>;
  export default details;
}

declare module 'virtual:bike-app/admin-organizers' {
  const organizers: Array<{
    slug: string; name: string; website?: string; instagram?: string;
  }>;
  export default organizers;
}

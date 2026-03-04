/// <reference types="astro/client" />

import type { SessionUser } from './lib/auth';
import type { AdminRoute, AdminRouteDetail, AdminEvent, AdminEventDetail, AdminOrganizer, AdminOrganizerRef } from './types/admin';

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
  const routes: AdminRoute[];
  export default routes;
}

declare module 'virtual:bike-app/admin-route-detail' {
  const details: Record<string, AdminRouteDetail>;
  export default details;
}

declare module 'virtual:bike-app/admin-events' {
  const events: AdminEvent[];
  export default events;
}

declare module 'virtual:bike-app/admin-event-detail' {
  const details: Record<string, AdminEventDetail>;
  export default details;
}

declare module 'virtual:bike-app/admin-organizers' {
  const organizers: AdminOrganizer[];
  export default organizers;
}

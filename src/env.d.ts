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
    R2: R2Bucket;
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
    GIT_BRANCH: string;
    ENVIRONMENT: string;
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
  }>;
  export default routes;
}

declare module 'virtual:bike-app/admin-route-detail' {
  interface AdminMediaItem {
    key: string;
    caption?: string;
    cover?: boolean;
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
  }
  const details: Record<string, AdminRouteDetail>;
  export default details;
}

import type { AstroIntegration } from 'astro';
import { isBlogInstance } from '../lib/config/city-config';
import { getContentTypes } from '../lib/content/content-types.server';

/** Resolve a view path relative to this file's location (works from node_modules too). */
const view = (rel: string) => new URL(`../views/${rel}`, import.meta.url).pathname;

// Content-type routes (admin pages + API) derived from registry.
// Entrypoints in the registry are relative view paths (e.g. 'admin/events.astro')
// — resolve them here at build time via view() so content-types.ts stays runtime-safe.
const contentTypeRoutes = getContentTypes().flatMap(ct => [
  ...(ct.adminListRoute ? [{ ...ct.adminListRoute, entrypoint: view(ct.adminListRoute.entrypoint) }] : []),
  ...(ct.adminDetailRoutes || []).map(r => ({ ...r, entrypoint: view(r.entrypoint) })),
  ...(ct.apiRoutes || []).map(r => ({ ...r, entrypoint: view(r.entrypoint) })),
]);

/**
 * All application routes — auth, admin, API, and public feeds.
 * Injected unconditionally so the app works both directly and as a package.
 */
const routes = [
  // Auth pages
  { pattern: '/setup', entrypoint: view('auth/setup.astro') },
  { pattern: '/login', entrypoint: view('auth/login.astro') },
  { pattern: '/gate', entrypoint: view('auth/gate.astro') },
  { pattern: '/register', entrypoint: view('auth/register.astro') },
  { pattern: '/auth/verify', entrypoint: view('auth/verify.astro') },
  // Auth API
  { pattern: '/api/auth/login-options', entrypoint: view('api/auth/login-options.ts') },
  { pattern: '/api/auth/login', entrypoint: view('api/auth/login.ts') },
  { pattern: '/api/auth/logout', entrypoint: view('api/auth/logout.ts') },
  { pattern: '/api/auth/guest', entrypoint: view('api/auth/guest.ts') },
  { pattern: '/api/auth/register', entrypoint: view('api/auth/register.ts') },
  { pattern: '/api/auth/register-options', entrypoint: view('api/auth/register-options.ts') },
  { pattern: '/api/auth/upgrade', entrypoint: view('api/auth/upgrade.ts') },
  { pattern: '/api/auth/upgrade-options', entrypoint: view('api/auth/upgrade-options.ts') },
  { pattern: '/api/auth/email-login', entrypoint: view('api/auth/email-login.ts') },
  { pattern: '/api/auth/add-passkey', entrypoint: view('api/auth/add-passkey.ts') },
  { pattern: '/api/auth/remove-passkey', entrypoint: view('api/auth/remove-passkey.ts') },
  { pattern: '/api/auth/strava/callback', entrypoint: view('api/auth/strava-callback.ts') },
  // Content-type admin pages and API endpoints (from registry)
  // Admin data endpoints (prerendered static JSON)
  { pattern: '/admin/data/routes.json', entrypoint: view('admin/data/routes.json.ts') },
  { pattern: '/admin/data/routes/[slug].json', entrypoint: view('admin/data/route-detail.json.ts') },
  { pattern: '/admin/data/known-tags.json', entrypoint: view('admin/data/known-tags.json.ts') },
  { pattern: '/admin/data/events.json', entrypoint: view('admin/data/events.json.ts') },
  { pattern: '/admin/data/events/[...id].json', entrypoint: view('admin/data/event-detail.json.ts') },
  { pattern: '/admin/data/places.json', entrypoint: view('admin/data/places.json.ts') },
  { pattern: '/admin/data/places/[id].json', entrypoint: view('admin/data/place-detail.json.ts') },
  { pattern: '/admin/data/organizers.json', entrypoint: view('admin/data/organizers.json.ts') },
  { pattern: '/admin/data/organizers/[slug].json', entrypoint: view('admin/data/organizer-detail.json.ts') },
  { pattern: '/admin/data/media-shared-keys.json', entrypoint: view('admin/data/media-shared-keys.json.ts') },
  { pattern: '/admin/data/media-locations.json', entrypoint: view('admin/data/media-locations.json.ts') },
  { pattern: '/admin/data/nearby-media.json', entrypoint: view('admin/data/nearby-media.json.ts') },
  { pattern: '/admin/data/parked-media.json', entrypoint: view('admin/data/parked-media.json.ts') },
  { pattern: '/admin/data/waypoint-suggestions/[slug].json', entrypoint: view('admin/data/waypoint-suggestions.json.ts') },
  ...contentTypeRoutes,
  // Dashboard — all instance types land here
  { pattern: '/admin', entrypoint: view('admin/dashboard.astro') },
  // Non-content-type admin pages
  { pattern: '/admin/history', entrypoint: view('admin/history.astro') },
  { pattern: '/admin/users', entrypoint: view('admin/users.astro') },
  { pattern: '/admin/settings', entrypoint: view('admin/settings.astro') },
  // Blog-only API routes (Strava integration — not part of content type registry)
  ...(isBlogInstance() ? [
    { pattern: '/api/strava/connect', entrypoint: view('api/strava/connect.ts') },
    { pattern: '/api/strava/disconnect', entrypoint: view('api/strava/disconnect.ts') },
    { pattern: '/api/strava/activities', entrypoint: view('api/strava/activities.ts') },
    { pattern: '/api/strava/import', entrypoint: view('api/strava/import.ts') },
  ] : []),
  // Video API (static routes before parameterized)
  { pattern: '/api/video/presign', entrypoint: view('api/video-presign.ts') },
  { pattern: '/api/video/webhook', entrypoint: view('api/video-webhook.ts') },
  { pattern: '/api/video/upload-local', entrypoint: view('api/video-upload-local.ts') },
  { pattern: '/api/video/status/[key]', entrypoint: view('api/video-status.ts') },
  // Media API
  { pattern: '/api/media/presign', entrypoint: view('api/media/presign.ts') },
  { pattern: '/api/media/confirm', entrypoint: view('api/media/confirm.ts') },
  { pattern: '/api/media/[key]', entrypoint: view('api/media-delete.ts') },
  // Admin API
  { pattern: '/api/admin/sync', entrypoint: view('api/admin-sync.ts') },
  { pattern: '/api/admin/users', entrypoint: view('api/admin-users.ts') },
  { pattern: '/api/admin/history', entrypoint: view('api/admin-history.ts') },
  { pattern: '/api/admin/revert', entrypoint: view('api/admin-revert.ts') },
  { pattern: '/api/admin/diff', entrypoint: view('api/admin-diff.ts') },
  { pattern: '/api/admin/event-draft', entrypoint: view('api/event-draft.ts') },
  { pattern: '/api/admin/fetch-image', entrypoint: view('api/fetch-image.ts') },
  { pattern: '/api/admin/deploy-status', entrypoint: view('api/admin-deploy-status.ts') },
  { pattern: '/api/settings', entrypoint: view('api/settings.ts') },
  { pattern: '/api/gpx/import', entrypoint: view('api/gpx/import.ts') },
  // Reactions (static _starred must precede parameterized to avoid matching as params)
  { pattern: '/api/reactions', entrypoint: view('api/reactions.ts') },
  { pattern: '/api/reactions/route/_starred', entrypoint: view('api/reactions-starred.ts') },
  { pattern: '/api/reactions/[contentType]/[contentSlug]', entrypoint: view('api/reactions-get.ts') },
  // Other API
  { pattern: '/api/event', entrypoint: view('api/event.ts') },
  { pattern: '/api/dev/upload', entrypoint: view('dev/upload.ts') },
  { pattern: '/api/tiles/[...path]', entrypoint: view('api/tile-proxy.ts') },
  { pattern: '/dev-uploads/[...path]', entrypoint: view('dev/dev-uploads.ts') },
  // Event preview (server-rendered fallback for pending events — middleware rewrites here)
  { pattern: '/_event-preview/[...id]', entrypoint: view('events/preview.astro') },
  // Public feeds and meta
  { pattern: '/404', entrypoint: view('404.astro') },
  { pattern: '/sitemap', entrypoint: view('sitemap.astro') },
  { pattern: '/sitemap.xml', entrypoint: view('sitemap.xml.ts') },
  { pattern: '/robots.txt', entrypoint: view('robots.txt.ts') },
  { pattern: '/rss.xml', entrypoint: view('rss.xml.ts') },
  { pattern: '/llms.txt', entrypoint: view('llms.txt.ts') },
  { pattern: '/llms-full.txt', entrypoint: view('llms-full.txt.ts') },
  { pattern: '/calendar.ics', entrypoint: view('calendar.ics.ts') },
];

export function appRoutesIntegration(): AstroIntegration {
  return {
    name: 'app-routes',
    hooks: {
      'astro:config:setup': ({ injectRoute }) => {
        for (const route of routes) {
          injectRoute(route);
        }
      },
    },
  };
}

import type { AstroIntegration } from 'astro';

/** Resolve a view path relative to this file's location (works from node_modules too). */
const view = (rel: string) => new URL(`../views/${rel}`, import.meta.url).pathname;

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
  // Auth API
  { pattern: '/api/auth/login-options', entrypoint: view('api/auth/login-options.ts') },
  { pattern: '/api/auth/login', entrypoint: view('api/auth/login.ts') },
  { pattern: '/api/auth/logout', entrypoint: view('api/auth/logout.ts') },
  { pattern: '/api/auth/guest', entrypoint: view('api/auth/guest.ts') },
  { pattern: '/api/auth/register', entrypoint: view('api/auth/register.ts') },
  { pattern: '/api/auth/register-options', entrypoint: view('api/auth/register-options.ts') },
  { pattern: '/api/auth/upgrade', entrypoint: view('api/auth/upgrade.ts') },
  { pattern: '/api/auth/upgrade-options', entrypoint: view('api/auth/upgrade-options.ts') },
  // Admin list pages
  { pattern: '/admin', entrypoint: view('admin/index.astro') },
  { pattern: '/admin/events', entrypoint: view('admin/events.astro') },
  { pattern: '/admin/places', entrypoint: view('admin/places.astro') },
  // Admin detail pages
  { pattern: '/admin/routes/new', entrypoint: view('admin/route-new.astro') },
  { pattern: '/admin/routes/[slug]', entrypoint: view('admin/route-detail.astro') },
  { pattern: '/admin/events/new', entrypoint: view('admin/event-new.astro') },
  { pattern: '/admin/events/[...id]', entrypoint: view('admin/event-detail.astro') },
  { pattern: '/admin/places/new', entrypoint: view('admin/place-new.astro') },
  { pattern: '/admin/places/[id]', entrypoint: view('admin/place-detail.astro') },
  { pattern: '/admin/history', entrypoint: view('admin/history.astro') },
  { pattern: '/admin/users', entrypoint: view('admin/users.astro') },
  { pattern: '/admin/settings', entrypoint: view('admin/settings.astro') },
  // Content API (static routes before parameterized)
  { pattern: '/api/routes/[slug]', entrypoint: view('api/route-save.ts') },
  { pattern: '/api/events/[...id]', entrypoint: view('api/event-save.ts') },
  { pattern: '/api/places/prefill', entrypoint: view('api/places-prefill.ts') },
  { pattern: '/api/places/[id]', entrypoint: view('api/place-save.ts') },
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
  // Public feeds and meta
  { pattern: '/404', entrypoint: view('404.astro') },
  { pattern: '/sitemap', entrypoint: view('sitemap.astro') },
  { pattern: '/sitemap.xml', entrypoint: view('sitemap.xml.ts') },
  { pattern: '/robots.txt', entrypoint: view('robots.txt.ts') },
  { pattern: '/rss.xml', entrypoint: view('rss.xml.ts') },
  { pattern: '/llms.txt', entrypoint: view('llms.txt.ts') },
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

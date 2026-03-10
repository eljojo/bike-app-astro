import type { AstroIntegration } from 'astro';

/** Resolve a view path relative to this file's location (works from node_modules too). */
const view = (rel: string) => new URL(`../views/${rel}`, import.meta.url).pathname;

/** Resolve a page path relative to src/pages/ (works from node_modules too). */
const page = (rel: string) => new URL(`../pages/${rel}`, import.meta.url).pathname;

/** Auth, admin, and API pages — injected so they work when consumed as a package. */
const pageRoutes = [
  // Auth pages
  { pattern: '/setup', entrypoint: page('setup.astro') },
  { pattern: '/login', entrypoint: page('login.astro') },
  { pattern: '/gate', entrypoint: page('gate.astro') },
  { pattern: '/register', entrypoint: page('register.astro') },
  // Auth API
  { pattern: '/api/auth/login-options', entrypoint: page('api/auth/login-options.ts') },
  { pattern: '/api/auth/login', entrypoint: page('api/auth/login.ts') },
  { pattern: '/api/auth/logout', entrypoint: page('api/auth/logout.ts') },
  { pattern: '/api/auth/guest', entrypoint: page('api/auth/guest.ts') },
  { pattern: '/api/auth/register', entrypoint: page('api/auth/register.ts') },
  { pattern: '/api/auth/register-options', entrypoint: page('api/auth/register-options.ts') },
  { pattern: '/api/auth/upgrade', entrypoint: page('api/auth/upgrade.ts') },
  { pattern: '/api/auth/upgrade-options', entrypoint: page('api/auth/upgrade-options.ts') },
  // Admin list pages
  { pattern: '/admin', entrypoint: page('admin/index.astro') },
  { pattern: '/admin/events', entrypoint: page('admin/events.astro') },
  { pattern: '/admin/places', entrypoint: page('admin/places.astro') },
  // Media API
  { pattern: '/api/media/presign', entrypoint: page('api/media/presign.ts') },
  { pattern: '/api/media/confirm', entrypoint: page('api/media/confirm.ts') },
  // Other API
  { pattern: '/api/event', entrypoint: page('api/event.ts') },
  { pattern: '/api/dev/upload', entrypoint: page('api/dev/upload.ts') },
  // Public feeds and meta
  { pattern: '/404', entrypoint: page('404.astro') },
  { pattern: '/sitemap', entrypoint: page('sitemap.astro') },
  { pattern: '/sitemap.xml', entrypoint: page('sitemap.xml.ts') },
  { pattern: '/robots.txt', entrypoint: page('robots.txt.ts') },
  { pattern: '/rss.xml', entrypoint: page('rss.xml.ts') },
  { pattern: '/llms.txt', entrypoint: page('llms.txt.ts') },
  { pattern: '/calendar.ics', entrypoint: page('calendar.ics.ts') },
];

/** Admin and API routes that need dynamic parameters, injected to avoid bracket filenames. */
const adminRoutes = [
  { pattern: '/admin/routes/new', entrypoint: view('admin/route-new.astro') },
  { pattern: '/admin/routes/[slug]', entrypoint: view('admin/route-detail.astro') },
  { pattern: '/admin/events/new', entrypoint: view('admin/event-new.astro') },
  { pattern: '/admin/events/[...id]', entrypoint: view('admin/event-detail.astro') },
  { pattern: '/api/routes/[slug]', entrypoint: view('api/route-save.ts') },
  { pattern: '/api/events/[...id]', entrypoint: view('api/event-save.ts') },
  { pattern: '/admin/places/new', entrypoint: view('admin/place-new.astro') },
  { pattern: '/admin/places/[id]', entrypoint: view('admin/place-detail.astro') },
  { pattern: '/api/places/prefill', entrypoint: view('api/places-prefill.ts') },
  { pattern: '/api/places/[id]', entrypoint: view('api/place-save.ts') },
  { pattern: '/api/media/[key]', entrypoint: view('api/media-delete.ts') },
  { pattern: '/api/admin/sync', entrypoint: view('api/admin-sync.ts') },
  { pattern: '/api/admin/users', entrypoint: view('api/admin-users.ts') },
  { pattern: '/api/admin/history', entrypoint: view('api/admin-history.ts') },
  { pattern: '/api/admin/revert', entrypoint: view('api/admin-revert.ts') },
  { pattern: '/api/admin/diff', entrypoint: view('api/admin-diff.ts') },
  { pattern: '/admin/history', entrypoint: view('admin/history.astro') },
  { pattern: '/admin/users', entrypoint: view('admin/users.astro') },
  { pattern: '/admin/settings', entrypoint: view('admin/settings.astro') },
  { pattern: '/api/settings', entrypoint: view('api/settings.ts') },
  { pattern: '/api/gpx/import', entrypoint: view('api/gpx/import.ts') },
  { pattern: '/api/reactions', entrypoint: view('api/reactions.ts') },
  // Static _starred must precede parameterized [contentType]/[contentSlug] to avoid matching as params
  { pattern: '/api/reactions/route/_starred', entrypoint: view('api/reactions-starred.ts') },
  { pattern: '/api/reactions/[contentType]/[contentSlug]', entrypoint: view('api/reactions-get.ts') },
  { pattern: '/api/tiles/[...path]', entrypoint: view('api/tile-proxy.ts') },
  { pattern: '/api/admin/event-draft', entrypoint: view('api/event-draft.ts') },
  { pattern: '/api/admin/fetch-image', entrypoint: view('api/fetch-image.ts') },
  { pattern: '/dev-uploads/[...path]', entrypoint: view('dev/dev-uploads.ts') },
];

// When consumed as a package (from node_modules), src/pages/ isn't visible to the
// consumer's Astro instance, so we inject those routes here. When running directly
// (the main project), src/pages/ handles them via file-based routing.
// TODO: Big refactor needed — move ALL src/pages/ files to src/views/ and inject
// them here unconditionally. That eliminates the dual-path and the collision warnings.
// This must be done before merging the blogs branch. See route collision warnings.
const isConsumedAsPackage = import.meta.dirname.includes('node_modules');

export function adminRoutesIntegration(): AstroIntegration {
  return {
    name: 'admin-routes',
    hooks: {
      'astro:config:setup': ({ injectRoute }) => {
        if (isConsumedAsPackage) {
          for (const route of pageRoutes) {
            injectRoute(route);
          }
        }
        for (const route of adminRoutes) {
          injectRoute(route);
        }
      },
    },
  };
}

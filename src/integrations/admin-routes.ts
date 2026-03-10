import type { AstroIntegration } from 'astro';

/** Resolve a view path relative to this file's location (works from node_modules too). */
const view = (rel: string) => new URL(`../views/${rel}`, import.meta.url).pathname;

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

export function adminRoutesIntegration(): AstroIntegration {
  return {
    name: 'admin-routes',
    hooks: {
      'astro:config:setup': ({ injectRoute }) => {
        for (const route of adminRoutes) {
          injectRoute(route);
        }
      },
    },
  };
}

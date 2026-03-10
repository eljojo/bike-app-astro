import type { AstroIntegration } from 'astro';

/** Admin and API routes that need dynamic parameters, injected to avoid bracket filenames. */
const adminRoutes = [
  { pattern: '/admin/routes/new', entrypoint: './src/views/admin/route-new.astro' },
  { pattern: '/admin/routes/[slug]', entrypoint: './src/views/admin/route-detail.astro' },
  { pattern: '/admin/events/new', entrypoint: './src/views/admin/event-new.astro' },
  { pattern: '/admin/events/[...id]', entrypoint: './src/views/admin/event-detail.astro' },
  { pattern: '/api/routes/[slug]', entrypoint: './src/views/api/route-save.ts' },
  { pattern: '/api/events/[...id]', entrypoint: './src/views/api/event-save.ts' },
  { pattern: '/admin/places/new', entrypoint: './src/views/admin/place-new.astro' },
  { pattern: '/admin/places/[id]', entrypoint: './src/views/admin/place-detail.astro' },
  { pattern: '/api/places/prefill', entrypoint: './src/views/api/places-prefill.ts' },
  { pattern: '/api/places/[id]', entrypoint: './src/views/api/place-save.ts' },
  { pattern: '/api/media/[key]', entrypoint: './src/views/api/media-delete.ts' },
  { pattern: '/api/admin/sync', entrypoint: './src/views/api/admin-sync.ts' },
  { pattern: '/api/admin/users', entrypoint: './src/views/api/admin-users.ts' },
  { pattern: '/api/admin/history', entrypoint: './src/views/api/admin-history.ts' },
  { pattern: '/api/admin/revert', entrypoint: './src/views/api/admin-revert.ts' },
  { pattern: '/api/admin/diff', entrypoint: './src/views/api/admin-diff.ts' },
  { pattern: '/admin/history', entrypoint: './src/views/admin/history.astro' },
  { pattern: '/admin/users', entrypoint: './src/views/admin/users.astro' },
  { pattern: '/admin/settings', entrypoint: './src/views/admin/settings.astro' },
  { pattern: '/api/settings', entrypoint: './src/views/api/settings.ts' },
  { pattern: '/api/gpx/import', entrypoint: './src/views/api/gpx/import.ts' },
  { pattern: '/api/reactions', entrypoint: './src/views/api/reactions.ts' },
  // Static _starred must precede parameterized [contentType]/[contentSlug] to avoid matching as params
  { pattern: '/api/reactions/route/_starred', entrypoint: './src/views/api/reactions-starred.ts' },
  { pattern: '/api/reactions/[contentType]/[contentSlug]', entrypoint: './src/views/api/reactions-get.ts' },
  { pattern: '/api/tiles/[...path]', entrypoint: './src/views/api/tile-proxy.ts' },
  { pattern: '/api/admin/event-draft', entrypoint: './src/views/api/event-draft.ts' },
  { pattern: '/api/admin/fetch-image', entrypoint: './src/views/api/fetch-image.ts' },
  { pattern: '/dev-uploads/[...path]', entrypoint: './src/views/dev/dev-uploads.ts' },
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

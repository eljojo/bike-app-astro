import type { AstroIntegration } from 'astro';

/** Admin and API routes that need dynamic parameters, injected to avoid bracket filenames. */
const adminRoutes = [
  { pattern: '/admin/routes/new', entrypoint: './src/views/admin/route-new.astro' },
  { pattern: '/admin/routes/[slug]', entrypoint: './src/views/admin/route-detail.astro' },
  { pattern: '/admin/events/new', entrypoint: './src/views/admin/event-new.astro' },
  { pattern: '/admin/events/[...id]', entrypoint: './src/views/admin/event-detail.astro' },
  { pattern: '/api/routes/[slug]', entrypoint: './src/views/api/route-save.ts' },
  { pattern: '/api/events/[...id]', entrypoint: './src/views/api/event-save.ts' },
  { pattern: '/api/media/[key]', entrypoint: './src/views/api/media-delete.ts' },
  { pattern: '/api/admin/sync', entrypoint: './src/views/api/admin-sync.ts' },
  { pattern: '/api/admin/users', entrypoint: './src/views/api/admin-users.ts' },
  { pattern: '/api/admin/history', entrypoint: './src/views/api/admin-history.ts' },
  { pattern: '/api/admin/revert', entrypoint: './src/views/api/admin-revert.ts' },
  { pattern: '/api/admin/diff', entrypoint: './src/views/api/admin-diff.ts' },
  { pattern: '/admin/history', entrypoint: './src/views/admin/history.astro' },
  { pattern: '/admin/users', entrypoint: './src/views/admin/users.astro' },
  { pattern: '/api/gpx/import-rwgps', entrypoint: './src/views/api/gpx/import-rwgps.ts' },
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

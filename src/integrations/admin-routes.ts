import type { AstroIntegration } from 'astro';

/** Admin and API routes that need dynamic parameters, injected to avoid bracket filenames. */
const adminRoutes = [
  { pattern: '/admin/routes/[slug]', entrypoint: './src/views/admin/route-detail.astro' },
  { pattern: '/api/routes/[slug]', entrypoint: './src/views/api/route-save.ts' },
  { pattern: '/api/media/[key]', entrypoint: './src/views/api/media-delete.ts' },
  { pattern: '/api/admin/sync', entrypoint: './src/views/api/admin-sync.ts' },
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

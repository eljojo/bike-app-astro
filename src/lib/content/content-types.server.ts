import { getInstanceFeatures } from '../config/instance-features';
import type { CurrentFiles } from './content-save';
import { routeOps, eventOps, placeOps, organizerOps, bikePathOps } from './content-ops.server';

export interface ContentTypeRoute {
  pattern: string;
  entrypoint: string;
}

export interface ContentTypeConfig {
  /** Identifier used in DB, URLs, virtual modules: 'routes', 'events', 'places' */
  name: string;
  /** Singular form for detail module naming: 'route', 'event', 'place' */
  singular: string;
  /** Display label for admin nav */
  label: string;
  /** Admin list page route */
  adminListRoute?: ContentTypeRoute;
  /** Admin detail + new page routes (static before parameterized) */
  adminDetailRoutes?: ContentTypeRoute[];
  /** API endpoint routes (static before parameterized) */
  apiRoutes?: ContentTypeRoute[];
  /** Instance feature gate — if set, content type is only active when this feature is true */
  featureGate?: keyof ReturnType<typeof getInstanceFeatures>;
  /** Shared operations for file path resolution, content hashing, and cache building */
  ops?: ContentOps;
}

export interface ContentOps {
  getFilePaths(contentId: string): { primary: string; auxiliary?: string[] };
  computeContentHash(currentFiles: CurrentFiles): string;
  buildFreshData(contentId: string, currentFiles: CurrentFiles): string;
}

/*
 * Future: genericizing `loadAdminContentList()` in load-admin-content.ts.
 * The three list overlay functions share the D1 query + parse + merge + append structure,
 * but differ in: (1) ID field (slug vs compound id), (2) which cached fields map to which
 * list fields, (3) new-item default shapes. A generic version would need three callbacks
 * (getKey, mergeFields, buildNewItem) that recreate most type-specific logic, so the
 * abstraction wouldn't reduce complexity meaningfully. Revisit if a 4th content type is added.
 */

export const contentTypes: ContentTypeConfig[] = [
  {
    name: 'routes',
    singular: 'route',
    label: 'Routes',
    featureGate: 'hasRoutes',
    ops: routeOps,
    adminListRoute: { pattern: '/admin/routes', entrypoint: 'admin/routes-list.astro' },
    adminDetailRoutes: [
      { pattern: '/admin/routes/new', entrypoint: 'admin/route-new.astro' },
      { pattern: '/admin/routes/[slug]', entrypoint: 'admin/route-detail.astro' },
    ],
    apiRoutes: [
      { pattern: '/api/routes/[slug]', entrypoint: 'api/route-save.ts' },
    ],
  },
  {
    name: 'events',
    singular: 'event',
    label: 'Events',
    featureGate: 'hasEvents',
    ops: eventOps,
    adminListRoute: { pattern: '/admin/events', entrypoint: 'admin/events.astro' },
    adminDetailRoutes: [
      { pattern: '/admin/events/new', entrypoint: 'admin/event-new.astro' },
      { pattern: '/admin/events/[...id]', entrypoint: 'admin/event-detail.astro' },
    ],
    apiRoutes: [
      { pattern: '/api/events/[...id]', entrypoint: 'api/event-save.ts' },
    ],
  },
  {
    name: 'places',
    singular: 'place',
    label: 'Places',
    ops: placeOps,
    adminListRoute: { pattern: '/admin/places', entrypoint: 'admin/places.astro' },
    adminDetailRoutes: [
      { pattern: '/admin/places/new', entrypoint: 'admin/place-new.astro' },
      { pattern: '/admin/places/[id]', entrypoint: 'admin/place-detail.astro' },
    ],
    apiRoutes: [
      { pattern: '/api/places/prefill', entrypoint: 'api/places-prefill.ts' },
      { pattern: '/api/places/[id]', entrypoint: 'api/place-save.ts' },
    ],
  },
  {
    name: 'bike-paths',
    singular: 'bike-path',
    label: 'Bike Paths',
    featureGate: 'hasPaths',
    ops: bikePathOps,
    adminListRoute: { pattern: '/admin/bike-paths', entrypoint: 'admin/bike-paths.astro' },
    adminDetailRoutes: [
      { pattern: '/admin/bike-paths/[id]', entrypoint: 'admin/bike-path-detail.astro' },
    ],
    apiRoutes: [
      { pattern: '/api/bike-paths/[id]', entrypoint: 'api/bike-path-save.ts' },
    ],
  },
  {
    name: 'organizers',
    singular: 'organizer',
    label: 'Communities',
    featureGate: 'hasEvents',
    ops: organizerOps,
    adminListRoute: { pattern: '/admin/communities', entrypoint: 'admin/community-list.astro' },
    adminDetailRoutes: [
      { pattern: '/admin/communities/new', entrypoint: 'admin/community-new.astro' },
      { pattern: '/admin/communities/[slug]', entrypoint: 'admin/community-detail.astro' },
    ],
    apiRoutes: [
      { pattern: '/api/organizers/[slug]', entrypoint: 'api/organizer-save.ts' },
    ],
  },
  {
    name: 'rides',
    singular: 'ride',
    label: 'Rides',
    featureGate: 'hasRides',
    adminListRoute: { pattern: '/admin/rides', entrypoint: 'admin/rides.astro' },
    adminDetailRoutes: [
      { pattern: '/admin/rides/new', entrypoint: 'admin/ride-detail.astro' },
      { pattern: '/admin/rides/[slug]', entrypoint: 'admin/ride-detail.astro' },
    ],
    apiRoutes: [
      { pattern: '/api/rides/[slug]', entrypoint: 'api/ride-save.ts' },
    ],
  },
];

/**
 * Returns content types active for the current instance type.
 * Consumers iterate this instead of hardcoding content type lists.
 */
export function getContentTypes(): ContentTypeConfig[] {
  const features = getInstanceFeatures();
  return contentTypes.filter(ct => {
    if (!ct.featureGate) return true;
    return features[ct.featureGate];
  });
}

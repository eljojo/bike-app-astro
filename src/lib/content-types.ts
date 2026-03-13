import { getInstanceFeatures } from './instance-features';

/** Resolve a view path relative to this file's location. */
const view = (rel: string) => new URL(`../views/${rel}`, import.meta.url).pathname;

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
  /** Admin data loader — returns { list, details } for virtual modules */
  loader: () => Promise<{ list: unknown; details: unknown }>;
  /** Admin list page route */
  adminListRoute?: ContentTypeRoute;
  /** Admin detail + new page routes (static before parameterized) */
  adminDetailRoutes?: ContentTypeRoute[];
  /** API endpoint routes (static before parameterized) */
  apiRoutes?: ContentTypeRoute[];
  /** Instance feature gate — if set, content type is only active when this feature is true */
  featureGate?: keyof ReturnType<typeof getInstanceFeatures>;
}

/*
 * TODO: Add `fromCache` parser and `adminListFields` normalizer to ContentTypeConfig.
 * This would allow `loadAdminContentList()` to become one generic function instead of
 * three copy-pasted ones (~150 lines total with ~70% overlap). Deferred because it needs
 * the registry and refactored save helpers to exist first. Revisit in Task 21.
 */

export const contentTypes: ContentTypeConfig[] = [
  {
    name: 'routes',
    singular: 'route',
    label: 'Routes',
    featureGate: 'hasRoutes',
    loader: () => import('../loaders/admin-routes').then(m => m.loadAdminRouteData()).then(d => ({ list: d.routes, details: d.details })),
    adminListRoute: { pattern: '/admin', entrypoint: view('admin/index.astro') },
    adminDetailRoutes: [
      { pattern: '/admin/routes/new', entrypoint: view('admin/route-new.astro') },
      { pattern: '/admin/routes/[slug]', entrypoint: view('admin/route-detail.astro') },
    ],
    apiRoutes: [
      { pattern: '/api/routes/[slug]', entrypoint: view('api/route-save.ts') },
    ],
  },
  {
    name: 'events',
    singular: 'event',
    label: 'Events',
    featureGate: 'hasEvents',
    loader: () => import('../loaders/admin-events').then(m => m.loadAdminEventData()).then(d => ({ list: d.events, details: d.details })),
    adminListRoute: { pattern: '/admin/events', entrypoint: view('admin/events.astro') },
    adminDetailRoutes: [
      { pattern: '/admin/events/new', entrypoint: view('admin/event-new.astro') },
      { pattern: '/admin/events/[...id]', entrypoint: view('admin/event-detail.astro') },
    ],
    apiRoutes: [
      { pattern: '/api/events/[...id]', entrypoint: view('api/event-save.ts') },
    ],
  },
  {
    name: 'places',
    singular: 'place',
    label: 'Places',
    loader: () => import('../loaders/admin-places').then(m => m.loadAdminPlaceData()).then(d => ({ list: d.places, details: d.details })),
    adminListRoute: { pattern: '/admin/places', entrypoint: view('admin/places.astro') },
    adminDetailRoutes: [
      { pattern: '/admin/places/new', entrypoint: view('admin/place-new.astro') },
      { pattern: '/admin/places/[id]', entrypoint: view('admin/place-detail.astro') },
    ],
    apiRoutes: [
      { pattern: '/api/places/prefill', entrypoint: view('api/places-prefill.ts') },
      { pattern: '/api/places/[id]', entrypoint: view('api/place-save.ts') },
    ],
  },
  {
    name: 'rides',
    singular: 'ride',
    label: 'Rides',
    featureGate: 'hasRides',
    loader: () => import('../loaders/admin-rides').then(m => m.loadAdminRideData()).then(d => ({ list: d.rides, details: d.details })),
    adminListRoute: { pattern: '/admin/rides', entrypoint: view('admin/rides.astro') },
    adminDetailRoutes: [
      { pattern: '/admin/rides/new', entrypoint: view('admin/ride-detail.astro') },
      { pattern: '/admin/rides/[slug]', entrypoint: view('admin/ride-detail.astro') },
    ],
    apiRoutes: [
      { pattern: '/api/rides/[slug]', entrypoint: view('api/ride-save.ts') },
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

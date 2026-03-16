import type { APIRoute, GetStaticPaths } from 'astro';
import { getCollection } from 'astro:content';
import fs from 'node:fs';
import { cityDir } from '../../lib/config/config';
import { variantSlug, routeGpxPath, gpxResponse } from '../../lib/gpx/download';
import { injectWaypointsIntoGpx, type GpxWaypoint } from '../../lib/gpx/waypoint-inject';

export const prerender = true;

export const getStaticPaths: GetStaticPaths = async () => {
  const events = await getCollection('events');
  const allRoutes = await getCollection('routes');
  const results: { params: { path: string }; props: Record<string, unknown> }[] = [];

  for (const event of events) {
    const routeSlugs = event.data.routes ?? [];
    if (routeSlugs.length === 0) continue;

    for (const routeSlug of routeSlugs) {
      const route = allRoutes.find((r: { id: string }) => r.id === routeSlug);
      if (!route) continue;

      for (const variant of route.data.variants) {
        const variantKey = variantSlug(variant.gpx);
        const gpxFilePath = routeGpxPath(cityDir, route.id, variant.gpx);
        if (fs.existsSync(gpxFilePath)) {
          results.push({
            params: { path: `${event.id}/${routeSlug}-${variantKey}` },
            props: {
              gpxFilePath,
              filename: `${event.data.name}-${route.data.name}-${variantKey}.gpx`,
              eventWaypoints: event.data.waypoints ?? [],
              gpxInclude: event.data.gpx_include_waypoints !== false,
              routeSlug,
            },
          });
        }
      }
    }
  }

  return results;
};

export const GET: APIRoute = async ({ props }) => {
  const { gpxFilePath, filename, eventWaypoints, gpxInclude } = props as {
    gpxFilePath: string;
    filename: string;
    eventWaypoints: Array<{ place: string; type: string; label: string; opening?: string; closing?: string; distance_km?: number; route?: string }>;
    gpxInclude: boolean;
  };

  let gpxContent = fs.readFileSync(gpxFilePath as string, 'utf-8');

  if (gpxInclude && eventWaypoints.length > 0) {
    const places = await getCollection('places');
    const gpxWaypoints: GpxWaypoint[] = [];

    for (const wp of eventWaypoints) {
      const place = places.find((p: { id: string }) => p.id === wp.place);
      if (!place) continue;

      let desc: string | undefined;
      if (wp.type === 'checkpoint') {
        const parts: string[] = [];
        if (wp.opening) parts.push(`Opens: ${wp.opening}`);
        if (wp.closing) parts.push(`Closes: ${wp.closing}`);
        if (wp.distance_km != null) parts.push(`${wp.distance_km} km`);
        if (parts.length > 0) desc = parts.join(', ');
      }

      gpxWaypoints.push({
        lat: place.data.lat,
        lng: place.data.lng,
        name: wp.label || place.data.name,
        type: wp.type,
        desc,
      });
    }

    gpxContent = injectWaypointsIntoGpx(gpxContent, gpxWaypoints);
  }

  return gpxResponse(gpxContent, filename);
};

import type { APIRoute, GetStaticPaths } from 'astro';
import { getCollection } from 'astro:content';
import { variantSlug, gpxResponse } from '../../lib/gpx/download.server';
import { buildGpxFromPoints } from '../../lib/geo/elevation-enrichment';
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
        const track = route.data.gpxTracks[variant.gpx];
        if (!track?.points?.length) continue;

        const variantKey = variantSlug(variant.gpx);
        results.push({
          params: { path: `${event.id}/${routeSlug}-${variantKey}` },
          props: {
            routeName: route.data.name,
            track: { points: track.points },
            filename: `${event.data.name}-${route.data.name}-${variantKey}.gpx`,
            eventWaypoints: event.data.waypoints ?? [],
            gpxInclude: event.data.gpx_include_waypoints !== false,
          },
        });
      }
    }
  }

  return results;
};

export const GET: APIRoute = async ({ props }) => {
  const { routeName, track, filename, eventWaypoints, gpxInclude } = props as {
    routeName: string;
    track: { points: { lat: number; lon: number; ele?: number }[] };
    filename: string;
    eventWaypoints: Array<{ place: string; type: string; label: string; opening?: string; closing?: string; distance_km?: number; route?: string }>;
    gpxInclude: boolean;
  };

  const points = track.points.map((p) => ({ lat: p.lat, lon: p.lon, ele: p.ele }));
  let gpxContent = buildGpxFromPoints(routeName, points);

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

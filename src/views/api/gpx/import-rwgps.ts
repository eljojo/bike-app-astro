import type { APIContext } from 'astro';
import { requireUser } from '../../../lib/auth';
import { jsonResponse, jsonError } from '../../../lib/api-response';

export const prerender = false;

const RWGPS_ROUTE_PATTERN = /ridewithgps\.com\/routes\/(\d+)/;

/** Extract route ID from a RideWithGPS URL. Exported for testing. */
export function parseRwgpsUrl(url: string): string | null {
  const match = url.match(RWGPS_ROUTE_PATTERN);
  return match ? match[1] : null;
}

export async function POST({ request, locals }: APIContext) {
  try {
    requireUser(locals.user);
  } catch {
    return jsonError('Unauthorized', 401);
  }

  const { url } = await request.json();
  if (!url || typeof url !== 'string') {
    return jsonError('Missing url', 400);
  }

  const routeId = parseRwgpsUrl(url);
  if (!routeId) {
    return jsonError('Invalid RideWithGPS URL. Expected: https://ridewithgps.com/routes/12345', 400);
  }

  const gpxUrl = `https://ridewithgps.com/routes/${routeId}.gpx`;

  const gpxResponse = await fetch(gpxUrl, {
    headers: {
      'User-Agent': 'ottawabybike.ca route importer',
    },
  });

  if (!gpxResponse.ok) {
    return jsonError(
      `Failed to fetch GPX from RideWithGPS (${gpxResponse.status}). Make sure the route is public.`,
      gpxResponse.status === 404 ? 404 : 502,
    );
  }

  const gpxContent = await gpxResponse.text();

  return jsonResponse({
    gpxContent,
    rwgpsUrl: `https://ridewithgps.com/routes/${routeId}`,
  });
}

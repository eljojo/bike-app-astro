import type { APIContext } from 'astro';
import { requireUser } from '../../../lib/auth';
import { jsonResponse, jsonError } from '../../../lib/api-response';

export const prerender = false;

const RWGPS_ROUTE_PATTERN = /ridewithgps\.com\/routes\/(\d+)\/?(?:\?privacy_code=([\w\d]+))?/;

/** Extract route ID and optional privacy code from a RideWithGPS URL. Exported for testing. */
export function parseRwgpsUrl(url: string): { routeId: string; privacyCode?: string } | null {
  const match = url.match(RWGPS_ROUTE_PATTERN);
  if (!match) return null;
  return { routeId: match[1], privacyCode: match[2] || undefined };
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

  const parsed = parseRwgpsUrl(url);
  if (!parsed) {
    return jsonError('Invalid RideWithGPS URL. Expected: https://ridewithgps.com/routes/12345', 400);
  }

  // sub_format=track ensures RWGPS returns <trkpt> (track points) instead of <rtept> (route waypoints)
  const params = new URLSearchParams({ sub_format: 'track' });
  if (parsed.privacyCode) {
    params.set('privacy_code', parsed.privacyCode);
  }

  const gpxUrl = `https://ridewithgps.com/routes/${parsed.routeId}.gpx?${params}`;

  const headers: Record<string, string> = {
    'User-Agent': `${new URL(import.meta.env.SITE).hostname} route importer`,
  };

  const { env } = await import('../../../lib/env');
  const apiKey = env.RWGPS_API_KEY;
  if (apiKey) {
    headers['x-rwgps-api-key'] = apiKey;
  }

  const gpxResponse = await fetch(gpxUrl, { headers });

  if (!gpxResponse.ok) {
    const hint = apiKey
      ? 'Make sure the route is public or include the privacy code.'
      : 'RWGPS_API_KEY is not configured — set it to enable authenticated GPX downloads.';
    return jsonError(
      `Failed to fetch GPX from RideWithGPS (${gpxResponse.status}). ${hint}`,
      gpxResponse.status === 404 ? 404 : 502,
    );
  }

  const gpxContent = await gpxResponse.text();

  return jsonResponse({
    gpxContent,
    rwgpsUrl: `https://ridewithgps.com/routes/${parsed.routeId}`,
  });
}

import type { APIContext } from 'astro';
import { authorize } from '../../../lib/authorize';
import { jsonResponse, jsonError } from '../../../lib/api-response';

export const prerender = false;

const RWGPS_ROUTE_PATTERN = /ridewithgps\.com\/routes\/(\d+)\/?(?:\?privacy_code=([\w\d]+))?/;

/** Extract route ID and optional privacy code from a RideWithGPS URL. Exported for testing. */
export function parseRwgpsUrl(url: string): { routeId: string; privacyCode?: string } | null {
  const match = url.match(RWGPS_ROUTE_PATTERN);
  if (!match) return null;
  return { routeId: match[1], privacyCode: match[2] || undefined };
}

interface RwgpsTrackPoint {
  x: number; // longitude
  y: number; // latitude
  e: number; // elevation (meters)
}

/** Build a GPX XML string from RWGPS API track points. */
export function buildGpxFromTrackPoints(name: string, points: RwgpsTrackPoint[]): string {
  const trkpts = points
    .map((p) => `      <trkpt lat="${p.y}" lon="${p.x}"><ele>${p.e}</ele></trkpt>`)
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="ridewithgps.com">
  <trk>
    <name>${escapeXml(name)}</name>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>`;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export async function POST({ request, locals }: APIContext) {
  const user = authorize(locals, 'import-gpx');
  if (user instanceof Response) return user;

  const { url } = await request.json();
  if (!url || typeof url !== 'string') {
    return jsonError('Missing url', 400);
  }

  const parsed = parseRwgpsUrl(url);
  if (!parsed) {
    return jsonError('Invalid RideWithGPS URL. Expected: https://ridewithgps.com/routes/12345', 400);
  }

  const { env } = await import('../../../lib/env');
  const apiKey = env.RWGPS_API_KEY;
  const authToken = env.RWGPS_AUTH_TOKEN;

  if (!apiKey || !authToken) {
    return jsonError('RWGPS_API_KEY and RWGPS_AUTH_TOKEN must both be configured.', 500);
  }

  // Use the JSON API (the web .gpx URL doesn't accept API auth)
  const apiUrl = `https://ridewithgps.com/api/v1/routes/${parsed.routeId}.json`;

  const response = await fetch(apiUrl, {
    headers: {
      'x-rwgps-api-key': apiKey,
      'x-rwgps-auth-token': authToken,
      'User-Agent': 'whereto-bike',
    },
  });

  if (!response.ok) {
    const body = await response.text();
    console.error(`RWGPS API error: ${response.status}`, body);
    return jsonError(
      `Failed to fetch route from RideWithGPS (${response.status}). Make sure the route exists and your API credentials are valid.`,
      response.status === 404 ? 404 : 502,
    );
  }

  const data = await response.json();
  const route = data.route;

  if (!route?.track_points?.length) {
    return jsonError('Route has no track points', 400);
  }

  const gpxContent = buildGpxFromTrackPoints(
    route.name || `RWGPS ${parsed.routeId}`,
    route.track_points,
  );

  return jsonResponse({
    gpxContent,
    rwgpsUrl: `https://ridewithgps.com/routes/${parsed.routeId}`,
  });
}

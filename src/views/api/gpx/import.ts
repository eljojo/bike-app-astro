import type { APIContext } from 'astro';
import { authorize } from '../../../lib/auth/authorize';
import { jsonResponse, jsonError } from '../../../lib/api-response';
import { parseRwgpsUrl, buildGpxFromTrackPoints } from './import-rwgps';
import { parseGoogleMapsUrl, extractKmlRoute } from '../../../lib/external/google-maps';
import { enrichWithElevation, buildGpxFromPoints } from '../../../lib/geo/elevation-enrichment';
import { unzipSync } from 'fflate';
import { checkRateLimit, recordAttempt, cleanupOldAttempts } from '../../../lib/auth/rate-limit';
import { db } from '../../../lib/get-db';

export const prerender = false;

/** Detect the import source from a URL. Returns null for unsupported URLs. */
export function detectUrlSource(url: string): 'rwgps' | 'google-maps' | null {
  if (parseRwgpsUrl(url)) return 'rwgps';
  if (parseGoogleMapsUrl(url)) return 'google-maps';
  return null;
}

async function handleRwgps(url: string): Promise<Response> {
  const parsed = parseRwgpsUrl(url)!;

  const { env } = await import('../../../lib/env/env.service');
  const apiKey = env.RWGPS_API_KEY;
  const authToken = env.RWGPS_AUTH_TOKEN;

  if (!apiKey || !authToken) {
    return jsonError('RWGPS_API_KEY and RWGPS_AUTH_TOKEN must both be configured.', 500);
  }

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

  const name = route.name || `RWGPS ${parsed.routeId}`;
  const gpxContent = buildGpxFromTrackPoints(name, route.track_points);

  return jsonResponse({
    gpxContent,
    sourceUrl: `https://ridewithgps.com/routes/${parsed.routeId}`,
    name,
  });
}

async function handleGoogleMaps(url: string): Promise<Response> {
  const parsed = parseGoogleMapsUrl(url)!;

  const kmzUrl = `https://www.google.com/maps/d/kml?mid=${parsed.mid}`;

  let kmzResponse: Response;
  try {
    kmzResponse = await fetch(kmzUrl, {
      signal: AbortSignal.timeout(10000),
    });
  } catch (err) {
    console.error('Failed to fetch KMZ:', err);
    return jsonError('Failed to fetch map data from Google Maps. The request timed out.', 504);
  }

  if (!kmzResponse.ok) {
    if (kmzResponse.status === 404) {
      return jsonError('Map not found. It may have been deleted.', 404);
    }
    return jsonError(
      `Failed to fetch map from Google Maps (${kmzResponse.status}). The map may be private or deleted.`,
      kmzResponse.status === 403 ? 403 : 502,
    );
  }

  const kmzBuffer = await kmzResponse.arrayBuffer();

  let kmlContent: string;
  try {
    const unzipped = unzipSync(new Uint8Array(kmzBuffer));
    const kmlFile = Object.keys(unzipped).find((name) => name.endsWith('.kml'));
    if (!kmlFile) {
      return jsonError('Invalid KMZ file: no KML content found.', 400);
    }
    kmlContent = new TextDecoder().decode(unzipped[kmlFile]);
  } catch (err) {
    console.error('Failed to unzip KMZ:', err);
    return jsonError('Invalid KMZ file: could not decompress.', 400);
  }

  const route = extractKmlRoute(kmlContent);
  if (!route) {
    return jsonError('No route (LineString) found in the map. Make sure the map contains a drawn route or directions.', 400);
  }

  const enrichedPoints = await enrichWithElevation(route.points);
  const gpxContent = buildGpxFromPoints(route.name, enrichedPoints);

  return jsonResponse({
    gpxContent,
    sourceUrl: url,
    name: route.name,
  });
}

export async function POST({ request, locals }: APIContext) {
  const user = authorize(locals, 'import-gpx');
  if (user instanceof Response) return user;

  const database = db();
  const identifiers = [user.id.toString()];
  const exceeded = await checkRateLimit(database, 'gpx-import', identifiers, 10);
  if (exceeded) {
    return jsonError('Too many imports. Try again later.', 429);
  }
  await recordAttempt(database, 'gpx-import', identifiers);
  cleanupOldAttempts(database, 'gpx-import').catch(() => {});

  const { url } = await request.json();
  if (!url || typeof url !== 'string') {
    return jsonError('Missing url', 400);
  }

  const source = detectUrlSource(url);
  if (!source) {
    return jsonError(
      'Unsupported URL. Supported sources: RideWithGPS (ridewithgps.com/routes/...), Google My Maps (google.com/maps/d/...)',
      400,
    );
  }

  switch (source) {
    case 'rwgps':
      return handleRwgps(url);
    case 'google-maps':
      return handleGoogleMaps(url);
  }
}

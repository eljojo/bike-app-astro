import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'astro/zod';
import polyline from '@mapbox/polyline';
import type { RoutingWaypoint, RoutingResult, RoutingService } from './routing';

const DIRECTIONS_API = 'https://maps.googleapis.com/maps/api/directions/json';

interface DirectionsApiResponse {
  status: string;
  error_message?: string;
  routes: Array<{
    legs: Array<{
      distance: { value: number };
      steps: Array<{ polyline: { points: string } }>;
    }>;
  }>;
}

/** In E2E mock mode, return fixture JSON instead of calling Google. */
function loadMockFixture(waypoints: RoutingWaypoint[]): DirectionsApiResponse | null {
  if (!process.env.MOCK_DIRECTIONS_API) return null;
  const hasShaping = waypoints.some(w => w.type === 'shaping');
  const name = hasShaping ? 'fixture3-directions.json' : 'fixture2-directions.json';
  try {
    return JSON.parse(readFileSync(join(process.cwd(), 'e2e/fixtures/google-directions', name), 'utf-8'));
  } catch {
    return null;
  }
}

/** Extract points and distance from a Directions API response. */
function processResponse(data: DirectionsApiResponse): RoutingResult {
  if (data.status === 'ZERO_RESULTS') {
    throw new Error('Google Directions returned no route for the given waypoints');
  }
  if (data.status !== 'OK') {
    throw new Error(`Google Directions API error: ${data.status}`);
  }

  const points: Array<{ lat: number; lon: number }> = [];
  let distance_m = 0;

  for (const leg of data.routes[0].legs) {
    distance_m += leg.distance.value;

    for (const step of leg.steps) {
      const decoded = polyline.decode(step.polyline.points);
      for (const [lat, lng] of decoded) {
        const last = points[points.length - 1];
        if (last && last.lat === lat && last.lon === lng) continue;
        points.push({ lat, lon: lng });
      }
    }
  }

  return { points, distance_m };
}

const waypointSchema = z.object({
  lat: z.number().min(-90).max(90).or(z.nan()),
  lng: z.number().min(-180).max(180).or(z.nan()),
  type: z.enum(['stop', 'via', 'shaping']),
  name: z.string().optional(),
}).refine(
  (wp) => wp.type === 'stop' || (!Number.isNaN(wp.lat) && !Number.isNaN(wp.lng)),
  { message: 'via and shaping waypoints must have valid coordinates' },
);

function formatWaypoint(wp: RoutingWaypoint): string {
  if (Number.isNaN(wp.lat) && wp.name) return wp.name;
  return `${wp.lat},${wp.lng}`;
}

function formatMiddleWaypoint(wp: RoutingWaypoint): string {
  const location = formatWaypoint(wp);
  if (wp.type === 'via' || wp.type === 'shaping') return `via:${location}`;
  return location;
}

export function createGoogleRoutingService(): RoutingService {
  return {
    async getRoute(waypoints: RoutingWaypoint[]): Promise<RoutingResult> {
      z.array(waypointSchema).max(25).parse(waypoints);

      const mock = loadMockFixture(waypoints);
      if (mock) return processResponse(mock);

      const { env } = await import('../env/env.service');
      const apiKey = env.GOOGLE_PLACES_API_KEY;
      if (!apiKey) throw new Error('Google Directions API key is not configured');

      const origin = formatWaypoint(waypoints[0]);
      const destination = formatWaypoint(waypoints[waypoints.length - 1]);
      const middle = waypoints.slice(1, -1);

      const params = new URLSearchParams({
        origin,
        destination,
        mode: 'bicycling',
        key: apiKey,
      });

      if (middle.length > 0) {
        params.set('waypoints', middle.map(formatMiddleWaypoint).join('|'));
      }

      const url = `${DIRECTIONS_API}?${params}`;
      const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      const data = await response.json() as DirectionsApiResponse;

      return processResponse(data);
    },
  };
}

import type { APIContext } from 'astro';
import { authorize } from '@/lib/authorize';
import { jsonResponse, jsonError } from '@/lib/api-response';
import { fetchActivities } from '@/lib/strava-api';
import { createStravaTokenProvider } from '@/lib/strava-token-provider';
import { db } from '@/lib/get-db';
import { env } from '@/lib/env';

export const prerender = false;

export async function GET({ locals, url }: APIContext) {
  const user = authorize(locals, 'import-gpx');
  if (user instanceof Response) return user;

  const database = db();

  const tokenProvider = await createStravaTokenProvider(database, env);
  if (!tokenProvider) {
    return jsonError('Strava not connected. Visit /api/strava/connect to authorize.', 401);
  }

  const page = parseInt(url.searchParams.get('page') || '1', 10);
  const perPage = parseInt(url.searchParams.get('per_page') || '20', 10);

  try {
    const activities = await fetchActivities(tokenProvider, page, Math.min(perPage, 50));
    return jsonResponse(activities);
  } catch (err) {
    console.error('Strava activities fetch error:', err);
    return jsonError('Failed to fetch activities from Strava', 502);
  }
}

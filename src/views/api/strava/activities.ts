import type { APIContext } from 'astro';
import { authorize } from '@/lib/auth/authorize';
import { jsonError } from '@/lib/api-response';
import { fetchActivities } from '@/lib/external/strava-api';
import { createStravaTokenProvider } from '@/lib/external/strava-token-provider';
import { db } from '@/lib/get-db';
import { env } from '@/lib/env/env.service';

export const prerender = false;

export async function GET({ locals, url }: APIContext) {
  const user = authorize(locals, 'import-gpx');
  if (user instanceof Response) return user;

  const database = db();

  const tokenProvider = await createStravaTokenProvider(database, env, user.id);
  if (!tokenProvider) {
    return jsonError('Strava not connected. Visit /api/strava/connect to authorize.', 401);
  }

  const page = parseInt(url.searchParams.get('page') || '1', 10);
  const perPage = parseInt(url.searchParams.get('per_page') || '20', 10);

  try {
    const activities = await fetchActivities(tokenProvider, page, Math.min(perPage, 50));
    return new Response(JSON.stringify(activities), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Strava activities fetch error:', err);
    return jsonError('Failed to fetch activities from Strava', 502);
  }
}

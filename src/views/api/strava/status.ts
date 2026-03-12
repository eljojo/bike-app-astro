import type { APIContext } from 'astro';
import { authorize } from '@/lib/authorize';
import { jsonResponse } from '@/lib/api-response';
import { db } from '@/lib/get-db';
import { env } from '@/lib/env';
import { stravaTokens } from '@/db/schema';

export const prerender = false;

export async function GET({ locals }: APIContext) {
  const user = authorize(locals, 'strava-connect');
  if (user instanceof Response) return user;

  const configured = !!(env.STRAVA_CLIENT_ID && env.STRAVA_CLIENT_SECRET);
  if (!configured) {
    return jsonResponse({ configured: false, connected: false });
  }

  const database = db();
  const rows = await database.select().from(stravaTokens).limit(1).all();
  const token = rows[0];

  return jsonResponse({
    configured: true,
    connected: !!token,
    athleteId: token?.athleteId ?? null,
  });
}

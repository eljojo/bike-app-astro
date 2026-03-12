import type { APIContext } from 'astro';
import { exchangeToken } from '@/lib/strava-api';
import { SITE_URL } from '@/lib/config';
import { db } from '@/lib/get-db';
import { env } from '@/lib/env';
import { stravaTokens } from '@/db/schema';

export const prerender = false;

export async function GET({ url, cookies }: APIContext) {
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  if (error) {
    return Response.redirect(`${SITE_URL}/admin/rides?strava=denied`, 302);
  }

  if (!code || !state) {
    return new Response('Missing code or state', { status: 400 });
  }

  // CSRF validation
  const storedState = cookies.get('strava_oauth_state')?.value;
  cookies.delete('strava_oauth_state', { path: '/' });

  if (!storedState || storedState !== state) {
    return new Response('Invalid state parameter', { status: 403 });
  }

  if (!env.STRAVA_CLIENT_ID || !env.STRAVA_CLIENT_SECRET) {
    return new Response('Strava not configured', { status: 500 });
  }

  const result = await exchangeToken(env.STRAVA_CLIENT_ID, env.STRAVA_CLIENT_SECRET, code);

  // Upsert token (single row, id=1)
  const database = db();
  await database
    .insert(stravaTokens)
    .values({
      id: 1,
      athleteId: String(result.athlete.id),
      accessToken: result.access_token,
      refreshToken: result.refresh_token,
      expiresAt: result.expires_at,
    })
    .onConflictDoUpdate({
      target: stravaTokens.id,
      set: {
        athleteId: String(result.athlete.id),
        accessToken: result.access_token,
        refreshToken: result.refresh_token,
        expiresAt: result.expires_at,
      },
    });

  return Response.redirect(`${SITE_URL}/admin/rides?strava=connected`, 302);
}

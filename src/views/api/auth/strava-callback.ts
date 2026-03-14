import type { APIContext } from 'astro';
import { exchangeToken } from '@/lib/external/strava-api';
import { validateSession } from '@/lib/auth';
import { db } from '@/lib/get-db';
import { env } from '@/lib/env';
import { stravaTokens } from '@/db/schema';

export const prerender = false;

export async function GET({ url, cookies }: APIContext) {
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  if (error) {
    return new Response(null, { status: 302, headers: { Location: `${url.origin}/admin/rides?strava=denied` } });
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

  // Identify the logged-in user
  const database = db();
  const sessionToken = cookies.get('session_token')?.value;
  if (!sessionToken) {
    return new Response('Not logged in', { status: 401 });
  }
  const user = await validateSession(database, sessionToken);
  if (!user) {
    return new Response('Invalid session', { status: 401 });
  }

  if (!env.STRAVA_CLIENT_ID || !env.STRAVA_CLIENT_SECRET) {
    return new Response('Strava not configured', { status: 500 });
  }

  const result = await exchangeToken(env.STRAVA_CLIENT_ID, env.STRAVA_CLIENT_SECRET, code);

  // Upsert token for this user
  await database
    .insert(stravaTokens)
    .values({
      userId: user.id,
      athleteId: String(result.athlete.id),
      accessToken: result.access_token,
      refreshToken: result.refresh_token,
      expiresAt: result.expires_at,
    })
    .onConflictDoUpdate({
      target: stravaTokens.userId,
      set: {
        athleteId: String(result.athlete.id),
        accessToken: result.access_token,
        refreshToken: result.refresh_token,
        expiresAt: result.expires_at,
      },
    });

  return new Response(null, { status: 302, headers: { Location: `${url.origin}/admin/rides?strava=connected` } });
}

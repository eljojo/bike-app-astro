import type { APIContext } from 'astro';
import { authorize } from '@/lib/authorize';
import { buildAuthorizationUrl } from '@/lib/strava-api';
import { env } from '@/lib/env';

export const prerender = false;

export async function GET({ locals, cookies, url }: APIContext) {
  const user = authorize(locals, 'strava-connect');
  if (user instanceof Response) return user;

  if (!env.STRAVA_CLIENT_ID) {
    return new Response('Strava not configured', { status: 500 });
  }

  // CSRF state token
  const state = crypto.randomUUID();
  cookies.set('strava_oauth_state', state, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 600, // 10 minutes
  });

  const redirectUri = `${url.origin}/api/auth/strava/callback`;
  const authUrl = buildAuthorizationUrl(env.STRAVA_CLIENT_ID, redirectUri, state);

  return new Response(null, {
    status: 302,
    headers: { Location: authUrl },
  });
}

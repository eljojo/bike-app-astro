import type { APIContext } from 'astro';
import { authorize } from '@/lib/authorize';
import { buildAuthorizationUrl } from '@/lib/strava-api';
import { SITE_URL } from '@/lib/config';
import { env } from '@/lib/env';

export const prerender = false;

export async function GET({ locals, cookies }: APIContext) {
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

  const redirectUri = `${SITE_URL}/api/auth/strava/callback`;
  const url = buildAuthorizationUrl(env.STRAVA_CLIENT_ID, redirectUri, state);

  return Response.redirect(url, 302);
}

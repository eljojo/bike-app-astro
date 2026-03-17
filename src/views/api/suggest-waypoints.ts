/**
 * Suggest waypoints for a route by finding nearby places.
 * POST /api/suggest-waypoints { routeSlug: string }
 *
 * Fetches prerendered waypoint suggestions from the static JSON endpoint
 * computed at build time. This avoids pulling the Astro content layer into
 * the Worker bundle.
 *
 * See src/integrations/AGENTS.md for route registration gotchas.
 */
import type { APIRoute } from 'astro';
import { authorize } from '@/lib/auth/authorize';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals, url }) => {
  const auth = authorize(locals, 'edit-content');
  if (auth instanceof Response) return auth;
  const body = await request.json();
  const routeSlug = body.routeSlug as string;

  if (!routeSlug) {
    return new Response(JSON.stringify({ error: 'routeSlug required' }), { status: 400 });
  }

  const jsonUrl = new URL(`/admin/data/waypoint-suggestions/${routeSlug}.json`, url);
  const res = await fetch(jsonUrl);

  if (!res.ok) {
    if (res.status === 404) {
      return new Response(JSON.stringify({ error: 'Route not found' }), { status: 404 });
    }
    return new Response(JSON.stringify({ error: 'Failed to load suggestions' }), { status: 502 });
  }

  const data = await res.json();
  return new Response(JSON.stringify(data));
};

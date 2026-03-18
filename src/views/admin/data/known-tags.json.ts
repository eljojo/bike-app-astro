import type { APIRoute } from 'astro';
import adminRouteDetails from 'virtual:bike-app/admin-route-detail';
import adminEvents from 'virtual:bike-app/admin-events';

export const prerender = true;

export const GET: APIRoute = async () => {
  const routeTags = Object.values(adminRouteDetails).flatMap(r => r.tags);
  const eventTags = adminEvents.flatMap(e => e.tags ?? []);
  const tags = [...new Set([...routeTags, ...eventTags])].sort();
  return new Response(JSON.stringify(tags), {
    headers: { 'Content-Type': 'application/json' },
  });
};

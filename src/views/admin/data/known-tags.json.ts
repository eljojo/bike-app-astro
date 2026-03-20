import type { APIRoute } from 'astro';
import adminRouteDetails from 'virtual:bike-app/admin-route-detail';
import adminEvents from 'virtual:bike-app/admin-events';
import adminOrganizers from 'virtual:bike-app/admin-organizers';

export const prerender = true;

export const GET: APIRoute = async () => {
  const routeTags = Object.values(adminRouteDetails).flatMap(r => r.tags);
  const eventTags = adminEvents.flatMap(e => e.tags ?? []);
  const organizerTags = adminOrganizers.flatMap(o => o.tags ?? []);
  const tags = [...new Set([...routeTags, ...eventTags, ...organizerTags])].sort();
  return new Response(JSON.stringify(tags), {
    headers: { 'Content-Type': 'application/json' },
  });
};

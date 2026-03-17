import type { APIRoute } from 'astro';
import adminEvents from 'virtual:bike-app/admin-events';
import adminOrganizers from 'virtual:bike-app/admin-organizers';

export const prerender = true;

export const GET: APIRoute = async () => {
  return new Response(JSON.stringify({ events: adminEvents, organizers: adminOrganizers }), {
    headers: { 'Content-Type': 'application/json' },
  });
};

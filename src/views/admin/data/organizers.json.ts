import type { APIRoute } from 'astro';
import adminOrganizers from 'virtual:bike-app/admin-organizers';

export const prerender = true;

export const GET: APIRoute = async () => {
  return new Response(JSON.stringify(adminOrganizers), {
    headers: { 'Content-Type': 'application/json' },
  });
};

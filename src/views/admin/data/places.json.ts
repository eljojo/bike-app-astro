import type { APIRoute } from 'astro';
import adminPlaces from 'virtual:bike-app/admin-places';

export const prerender = true;

export const GET: APIRoute = async () => {
  return new Response(JSON.stringify(adminPlaces), {
    headers: { 'Content-Type': 'application/json' },
  });
};

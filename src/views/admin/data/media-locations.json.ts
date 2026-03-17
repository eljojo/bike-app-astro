import type { APIRoute } from 'astro';
import locations from 'virtual:bike-app/media-locations';

export const prerender = true;

export const GET: APIRoute = async () => {
  return new Response(JSON.stringify(locations), {
    headers: { 'Content-Type': 'application/json' },
  });
};

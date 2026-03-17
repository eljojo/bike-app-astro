import type { APIRoute } from 'astro';
import nearbyMedia from 'virtual:bike-app/nearby-media';

export const prerender = true;

export const GET: APIRoute = async () => {
  return new Response(JSON.stringify(nearbyMedia), {
    headers: { 'Content-Type': 'application/json' },
  });
};

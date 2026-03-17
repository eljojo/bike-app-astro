import type { APIRoute } from 'astro';
import parkedMedia from 'virtual:bike-app/parked-media';

export const prerender = true;

export const GET: APIRoute = async () => {
  return new Response(JSON.stringify(parkedMedia), {
    headers: { 'Content-Type': 'application/json' },
  });
};

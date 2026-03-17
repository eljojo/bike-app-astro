import type { APIRoute } from 'astro';
import sharedKeys from 'virtual:bike-app/media-shared-keys';

export const prerender = true;

export const GET: APIRoute = async () => {
  return new Response(JSON.stringify(sharedKeys), {
    headers: { 'Content-Type': 'application/json' },
  });
};

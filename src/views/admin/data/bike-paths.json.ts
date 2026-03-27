import type { APIRoute } from 'astro';
import adminBikePaths from 'virtual:bike-app/admin-bike-paths';

export const prerender = true;

export const GET: APIRoute = async () => {
  return new Response(JSON.stringify(adminBikePaths), {
    headers: { 'Content-Type': 'application/json' },
  });
};

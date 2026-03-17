import type { APIRoute } from 'astro';
import adminRoutes from 'virtual:bike-app/admin-routes';

export const prerender = true;

export const GET: APIRoute = async () => {
  return new Response(JSON.stringify(adminRoutes), {
    headers: { 'Content-Type': 'application/json' },
  });
};

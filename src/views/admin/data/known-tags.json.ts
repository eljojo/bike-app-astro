import type { APIRoute } from 'astro';
import adminRouteDetails from 'virtual:bike-app/admin-route-detail';

export const prerender = true;

export const GET: APIRoute = async () => {
  const tags = [...new Set(Object.values(adminRouteDetails).flatMap(r => r.tags))].sort();
  return new Response(JSON.stringify(tags), {
    headers: { 'Content-Type': 'application/json' },
  });
};

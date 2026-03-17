import type { APIRoute, GetStaticPaths } from 'astro';
import adminRouteDetails from 'virtual:bike-app/admin-route-detail';
import { loadBuildPlan, filterByBuildPlan } from '@/lib/content/build-plan.server';

export const prerender = true;

export const getStaticPaths: GetStaticPaths = async () => {
  const all = Object.keys(adminRouteDetails).map(slug => ({ id: slug }));
  const filtered = filterByBuildPlan(all, loadBuildPlan(), 'route');
  return filtered.map(({ id: slug }) => ({
    params: { slug },
    props: { detail: adminRouteDetails[slug] },
  }));
};

export const GET: APIRoute = async ({ props }) => {
  return new Response(JSON.stringify(props.detail), {
    headers: { 'Content-Type': 'application/json' },
  });
};

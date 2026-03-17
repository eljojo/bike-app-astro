import type { APIRoute, GetStaticPaths } from 'astro';
import adminRouteDetails from 'virtual:bike-app/admin-route-detail';

export const prerender = true;

export const getStaticPaths: GetStaticPaths = async () => {
  return Object.keys(adminRouteDetails).map(slug => ({
    params: { slug },
    props: { detail: adminRouteDetails[slug] },
  }));
};

export const GET: APIRoute = async ({ props }) => {
  return new Response(JSON.stringify(props.detail), {
    headers: { 'Content-Type': 'application/json' },
  });
};

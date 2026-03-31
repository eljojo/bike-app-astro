import type { APIRoute, GetStaticPaths } from 'astro';
import adminBikePathDetails from 'virtual:bike-app/admin-bike-path-detail';

export const prerender = true;

export const getStaticPaths: GetStaticPaths = async () => {
  return Object.keys(adminBikePathDetails).map(id => ({
    params: { id },
    props: { detail: adminBikePathDetails[id] },
  }));
};

export const GET: APIRoute = async ({ props }) => {
  return new Response(JSON.stringify(props.detail), {
    headers: { 'Content-Type': 'application/json' },
  });
};

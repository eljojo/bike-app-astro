import type { APIRoute, GetStaticPaths } from 'astro';
import adminPlaceDetails from 'virtual:bike-app/admin-place-detail';

export const prerender = true;

export const getStaticPaths: GetStaticPaths = async () => {
  return Object.keys(adminPlaceDetails).map(id => ({
    params: { id },
    props: { detail: adminPlaceDetails[id] },
  }));
};

export const GET: APIRoute = async ({ props }) => {
  return new Response(JSON.stringify(props.detail), {
    headers: { 'Content-Type': 'application/json' },
  });
};

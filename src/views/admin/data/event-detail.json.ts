import type { APIRoute, GetStaticPaths } from 'astro';
import adminEventDetails from 'virtual:bike-app/admin-event-detail';

export const prerender = true;

export const getStaticPaths: GetStaticPaths = async () => {
  return Object.keys(adminEventDetails).map(id => ({
    params: { id },
    props: { detail: adminEventDetails[id] },
  }));
};

export const GET: APIRoute = async ({ props }) => {
  return new Response(JSON.stringify(props.detail), {
    headers: { 'Content-Type': 'application/json' },
  });
};

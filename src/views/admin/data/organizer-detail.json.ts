import type { APIRoute, GetStaticPaths } from 'astro';
import adminOrganizerDetails from 'virtual:bike-app/admin-organizer-detail';

export const prerender = true;

export const getStaticPaths: GetStaticPaths = async () => {
  return Object.keys(adminOrganizerDetails).map(slug => ({
    params: { slug },
    props: { detail: adminOrganizerDetails[slug] },
  }));
};

export const GET: APIRoute = async ({ props }) => {
  return new Response(JSON.stringify(props.detail), {
    headers: { 'Content-Type': 'application/json' },
  });
};

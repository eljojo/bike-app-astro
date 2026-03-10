// eslint-disable-next-line bike-app/require-authorize-call -- Plausible analytics proxy, intentionally public
import type { APIRoute } from 'astro';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const headers = new Headers(request.headers);
  headers.delete('cookie');

  const body = await request.text();
  return fetch('https://plausible.io/api/event', {
    method: 'POST',
    headers,
    body,
  });
};

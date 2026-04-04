// eslint-disable-next-line bike-app/require-authorize-call -- Plausible analytics proxy, intentionally public
import type { APIRoute } from 'astro';
import { getCityConfig } from '../../lib/config/city-config';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const body = await request.text();

  // Validate that the domain field matches the configured analytics domain
  try {
    const parsed = JSON.parse(body);
    const expectedDomain = getCityConfig().plausible_domain;
    if (!parsed.d || parsed.d !== expectedDomain) {
      return new Response('Invalid domain', { status: 403 });
    }
  } catch {
    return new Response('Invalid request body', { status: 400 });
  }

  const headers = new Headers(request.headers);
  headers.delete('cookie');

  return fetch('https://plausible.io/api/event', {
    method: 'POST',
    headers,
    body,
  });
};

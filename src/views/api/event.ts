// eslint-disable-next-line bike-app/require-authorize-call -- Plausible analytics proxy, intentionally public
import type { APIRoute } from 'astro';
import { getCityConfig } from '../../lib/config/city-config';

export const prerender = false;

/** Simple in-memory rate limiter: 60 requests/min per IP */
const ipCounts = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = ipCounts.get(ip);
  if (!entry || now > entry.resetAt) {
    ipCounts.set(ip, { count: 1, resetAt: now + 60_000 });
    return false;
  }
  entry.count++;
  return entry.count > 60;
}

export const POST: APIRoute = async ({ request }) => {
  const clientIp = request.headers.get('cf-connecting-ip')
    || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || 'unknown';

  if (isRateLimited(clientIp)) {
    return new Response('Rate limit exceeded', { status: 429 });
  }

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

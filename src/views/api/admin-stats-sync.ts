import type { APIContext } from 'astro';
import { authorize } from '../../lib/auth/authorize';
import { jsonResponse, jsonError } from '../../lib/api-response';
import { getInstanceFeatures } from '../../lib/config/instance-features';
import { db } from '../../lib/get-db';
import { env } from '../../lib/env/env.service';
import { CITY } from '../../lib/config/config';
import { getCityConfig } from '../../lib/config/city-config';
import { runSync } from '../../lib/stats/sync.server';
import { fetchJson } from '../../lib/content/load-admin-content.server';

export const prerender = false;

export async function POST({ locals, url }: APIContext) {
  if (!getInstanceFeatures().hasRoutes) {
    return new Response(null, { status: 404 });
  }

  const user = authorize(locals, 'sync-stats');
  if (user instanceof Response) return user;

  const apiKey = env.PLAUSIBLE_API_KEY;
  if (!apiKey) {
    return jsonError('Plausible sync requires PLAUSIBLE_API_KEY — not available in local development', 400);
  }

  const cityConfig = getCityConfig();
  const database = db();
  const fullSync = url.searchParams.get('full') === 'true';

  try {
    const redirects = await fetchJson<Record<string, string>>(new URL('/admin/data/redirects.json', url.origin)).catch(() => ({}));

    const result = await runSync(database, {
      apiKey,
      siteId: cityConfig.plausible_domain,
      city: CITY,
      locales: cityConfig.locales ?? [cityConfig.locale],
      defaultLocale: cityConfig.locale,
      redirects,
      full: fullSync,
    });

    return jsonResponse(result as unknown as Record<string, unknown>);
  } catch (err: unknown) {
    console.error('stats sync error:', err);
    const message = err instanceof Error ? err.message : 'Failed to sync';
    return jsonError(message, 500);
  }
}

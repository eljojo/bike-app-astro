import type { APIContext } from 'astro';
import { authorize } from '../../lib/auth/authorize';
import { jsonResponse, jsonError } from '../../lib/api-response';
import { getInstanceFeatures } from '../../lib/config/instance-features';
import { db } from '../../lib/get-db';
import { runSync } from '../../lib/stats/sync.server';
import { buildSyncContext } from '../../lib/stats/sync-context.server';

export const prerender = false;

export async function POST({ locals, url }: APIContext) {
  if (!getInstanceFeatures().hasRoutes) {
    return new Response(null, { status: 404 });
  }

  const user = authorize(locals, 'sync-stats');
  if (user instanceof Response) return user;

  const ctx = await buildSyncContext(url.origin);
  if (!ctx) {
    return jsonError('Plausible sync requires PLAUSIBLE_API_KEY — not available in local development', 400);
  }

  const database = db();
  const fullSync = url.searchParams.get('full') === 'true';

  try {
    const result = await runSync(database, { ...ctx, full: fullSync });

    return jsonResponse(result as unknown as Record<string, unknown>);
  } catch (err: unknown) {
    console.error('stats sync error:', err);
    const message = err instanceof Error ? err.message : 'Failed to sync';
    return jsonError(message, 500);
  }
}

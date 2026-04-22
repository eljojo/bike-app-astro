import type { APIContext } from 'astro';
import { z } from 'zod/v4';
import { authorize } from '../../lib/auth/authorize';
import { jsonResponse, jsonError } from '../../lib/api-response';
import { db } from '../../lib/get-db';
import { CITY } from '../../lib/config/config';
import { dismissSuggestion } from '../../lib/calendar-suggestions/cache.server';

export const prerender = false;

const bodySchema = z.object({
  uid: z.string().min(1),
  organizer_slug: z.string().min(1),
  snapshot: z.object({ name: z.string(), start: z.string() }).optional(),
});

export async function POST({ locals, request }: APIContext) {
  const user = authorize(locals, 'manage-calendar-suggestions');
  if (user instanceof Response) return user;

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return jsonError('Bad request', 400);
  }

  try {
    await dismissSuggestion(db(), CITY, body.uid, body.organizer_slug, user.id, body.snapshot);
    return jsonResponse({ ok: true });
  } catch (err: unknown) {
    console.error('calendar suggestion dismiss error:', err);
    const message = err instanceof Error ? err.message : 'Failed to dismiss';
    return jsonError(message, 500);
  }
}

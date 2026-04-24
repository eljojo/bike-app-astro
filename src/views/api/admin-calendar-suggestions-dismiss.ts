import type { APIContext } from 'astro';
import { z } from 'zod/v4';
import { authorize } from '../../lib/auth/authorize';
import { jsonResponse, jsonError } from '../../lib/api-response';
import { db } from '../../lib/get-db';
import { CITY } from '../../lib/config/config';
import { dismissSuggestion } from '../../lib/calendar-suggestions/dismissals.server';

export const prerender = false;

const bodySchema = z.object({
  uid: z.string().min(1),
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
    await dismissSuggestion(db(), CITY, body.uid);
    return jsonResponse({ ok: true });
  } catch (err: unknown) {
    console.error('calendar suggestion dismiss error:', err);
    return jsonError('Failed to dismiss', 500);
  }
}


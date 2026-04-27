import type { APIContext } from 'astro';
import { z } from 'zod/v4';
import { authorize } from '../../lib/auth/authorize';
import { jsonResponse, jsonError } from '../../lib/api-response';
import { db } from '../../lib/get-db';
import { CITY } from '../../lib/config/config';
import { dismissSuggestion } from '../../lib/calendar-suggestions/dismissals.server';

export const prerender = false;

// Body shape: `{ organizer_slug, uid }`. The PK is `(city, organizer_slug, uid)`
// so two organizer feeds can both dismiss the same UID independently. The sidebar
// passes both fields as part of the suggestion's `dismissPayload`.
const bodySchema = z.object({
  organizer_slug: z.string().min(1),
  uid:            z.string().min(1),
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
    await dismissSuggestion(db(), CITY, body.organizer_slug, body.uid);
    return jsonResponse({ ok: true });
  } catch (err: unknown) {
    console.error('calendar suggestion dismiss error:', err);
    return jsonError('Failed to dismiss', 500);
  }
}

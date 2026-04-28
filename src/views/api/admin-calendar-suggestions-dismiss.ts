import type { APIContext } from 'astro';
import { z } from 'zod/v4';
import { authorize } from '../../lib/auth/authorize';
import { jsonResponse, jsonError } from '../../lib/api-response';
import { db } from '../../lib/get-db';
import { CITY } from '../../lib/config/config';
import { dismissSuggestion } from '../../lib/calendar-suggestions/dismissals.server';

export const prerender = false;

// Body shape: `{ organizer_slug, uid, valid_until }`. The PK is
// `(city, organizer_slug, uid)`; `valid_until` is a YYYY-MM-DD date past
// which the dismissal can be ignored, set by the producing endpoint per
// suggestion (one-off start date, recurrence season_end, etc.). The sidebar
// passes all three as part of the suggestion's `dismissPayload`.
const bodySchema = z.object({
  organizer_slug: z.string().min(1),
  uid:            z.string().min(1),
  valid_until:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD'),
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
    await dismissSuggestion(db(), CITY, body.organizer_slug, body.uid, body.valid_until);
    return jsonResponse({ ok: true });
  } catch (err: unknown) {
    console.error('calendar suggestion dismiss error:', err);
    return jsonError('Failed to dismiss', 500);
  }
}

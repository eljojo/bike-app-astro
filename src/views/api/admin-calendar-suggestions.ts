import type { APIContext } from 'astro';
import { authorize } from '../../lib/auth/authorize';
import { jsonResponse, jsonError } from '../../lib/api-response';
import { db } from '../../lib/get-db';
import { CITY } from '../../lib/config/config';
import adminOrganizers from 'virtual:bike-app/admin-organizers';
import adminEventsVirtual from 'virtual:bike-app/admin-events';
import { buildSuggestions } from '../../lib/calendar-suggestions/build.server';

export const prerender = false;

export async function GET({ locals }: APIContext) {
  const user = authorize(locals, 'manage-calendar-suggestions');
  if (user instanceof Response) return user;

  try {
    const suggestions = await buildSuggestions({
      db: db(),
      city: CITY,
      organizers: adminOrganizers,
      repoEvents: adminEventsVirtual,
    });
    return jsonResponse({ suggestions, meta: {} });
  } catch (err: unknown) {
    console.error('calendar suggestions error:', err);
    const message = err instanceof Error ? err.message : 'Failed to build suggestions';
    return jsonError(message, 500);
  }
}

import type { APIContext } from 'astro';
import { authorize } from '../../lib/auth/authorize';
import { jsonResponse, jsonError } from '../../lib/api-response';
import { db } from '../../lib/get-db';
import { CITY } from '../../lib/config/config';
import adminOrganizers from 'virtual:bike-app/admin-organizers';
import adminEventsVirtual from 'virtual:bike-app/admin-events';
import { loadAdminEventList } from '../../lib/content/load-admin-content.server';
import { buildSuggestions } from '../../lib/calendar-suggestions/build.server';

export const prerender = false;

export async function GET({ locals }: APIContext) {
  const user = authorize(locals, 'manage-calendar-suggestions');
  if (user instanceof Response) return user;

  try {
    // Use the D1-overlaid event list, not the raw virtual module. Between deploys,
    // newly-saved events (via admin) exist only in the content_edits cache. Without
    // the overlay, ics_uid writes are invisible until redeploy and the matching suggestion
    // keeps reappearing in the sidebar.
    const { events: repoEvents } = await loadAdminEventList(adminEventsVirtual);
    const suggestions = await buildSuggestions({
      db: db(),
      city: CITY,
      organizers: adminOrganizers,
      repoEvents,
    });
    return jsonResponse({ suggestions, meta: {} });
  } catch (err: unknown) {
    console.error('calendar suggestions error:', err);
    return jsonError('Failed to build suggestions', 500);
  }
}

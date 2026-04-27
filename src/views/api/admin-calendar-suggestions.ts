import type { APIContext } from 'astro';
import { authorize } from '../../lib/auth/authorize';
import { jsonResponse, jsonError } from '../../lib/api-response';
import { db } from '../../lib/get-db';
import { CITY } from '../../lib/config/config';
import { getCityConfig } from '../../lib/config/city-config';
import { calendarFeedCache } from '../../lib/env/env.service';
import adminOrganizers from 'virtual:bike-app/admin-organizers';
import adminEventsVirtual from 'virtual:bike-app/admin-events';
import { loadAdminEventList } from '../../lib/content/load-admin-content.server';
import { buildSuggestions } from '../../lib/calendar-suggestions/build.server';
import { fetchIcsFeed } from '../../lib/external/ics-feed.server';

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
    // City TZ is the fallback for VEVENTs without TZID (Google Calendar emits
    // bare DTSTART:…Z literals for some events even when the calendar itself is
    // local). Without this, those events serialize as UTC and admins see a
    // 4–5h skew on prefill.
    const cityTz = getCityConfig().timezone;
    const suggestions = await buildSuggestions({
      db: db(),
      city: CITY,
      organizers: adminOrganizers,
      repoEvents,
      feedCache: calendarFeedCache,
      fetcher: (url) => fetchIcsFeed(url, cityTz),
    });
    return jsonResponse({ suggestions, meta: {} });
  } catch (err: unknown) {
    console.error('calendar suggestions error:', err);
    return jsonError('Failed to build suggestions', 500);
  }
}

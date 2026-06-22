import type { APIContext } from 'astro';
import { Temporal } from '@js-temporal/polyfill';
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
import type { Suggestion, UpdateDiff } from '../../lib/calendar-suggestions/types';
import type { SuggestionItem } from '../../components/admin/Suggestions';

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
    const cityConfig = getCityConfig();
    const suggestions = await buildSuggestions({
      db: db(),
      city: CITY,
      organizers: adminOrganizers,
      repoEvents,
      feedCache: calendarFeedCache,
      // City TZ is the fallback for VEVENTs without TZID (Google Calendar emits
      // bare DTSTART:…Z literals for some events even when the calendar itself is
      // local) AND the projection target for filter comparisons.
      fetcher: (url) => fetchIcsFeed(url, cityConfig.timezone),
      siteTz: cityConfig.timezone,
    });
    // Map server-internal Suggestion → the generic SuggestionItem shape that
    // the <Suggestions> component renders. All formatting (dates, hrefs,
    // dismiss payload) lives here, next to the data.
    const items = suggestions.map(s => toSuggestionItem(s, cityConfig.timezone, cityConfig.locale));
    return jsonResponse({ suggestions: items, meta: {} });
  } catch (err: unknown) {
    console.error('calendar suggestions error:', err);
    return jsonError('Failed to build suggestions', 500);
  }
}

export function toSuggestionItem(s: Suggestion, siteTz: string, locale: string): SuggestionItem {
  if (s.kind === 'review') {
    return {
      id:    `${s.organizer_slug}:${s.uid}`,
      title: s.name,
      meta:  formatReviewMeta(s.diff, s.organizer_name, siteTz, locale),
      href:  `/admin/events/${encodeURIComponent(s.event_id)}/review-update`,
      dismissPayload: {
        kind: 'review',
        organizer_slug: s.organizer_slug,
        uid: s.uid,
        event_id: s.event_id,
      },
    };
  }
  const meta = s.kind === 'series'
    ? (s.series_label ?? 'Series')
    : `${formatShortDate(s.start, siteTz, locale)} · ${s.organizer_name}`;
  const fullParam = s.kind === 'series' ? '&full=1' : '';
  return {
    id:    `${s.organizer_slug}:${s.uid}`,
    title: s.name,
    // For one-offs we already include the organizer in `meta`; keeping it out
    // of `title` matches the spacing the design calls for.
    meta:  s.kind === 'series' ? `${meta} · ${s.organizer_name}` : meta,
    href:  `/admin/events/new?from_feed=${encodeURIComponent(s.organizer_slug)}&uid=${encodeURIComponent(s.uid)}${fullParam}`,
    dismissPayload: {
      kind: 'import',
      organizer_slug: s.organizer_slug,
      uid: s.uid,
      valid_until: s.valid_until,
    },
  };
}

function formatReviewMeta(d: UpdateDiff, org: string, siteTz: string, locale: string): string {
  if (d.eventRemoved) return `Event removed · ${org}`;

  const parts: string[] = [];
  if (d.master.length === 1) parts.push(`${d.master[0].field} changed`);
  else if (d.master.length > 1) parts.push(`${d.master.length} fields changed`);
  if (d.occurrencesChanged.length > 0) parts.push(`${d.occurrencesChanged.length} occurrences updated`);
  if (d.occurrencesAdded.length > 0)   parts.push(`${d.occurrencesAdded.length} new date${d.occurrencesAdded.length === 1 ? '' : 's'}`);
  if (d.occurrencesNewlyCancelled.length > 0) parts.push(`${d.occurrencesNewlyCancelled.length} cancelled`);
  if (d.occurrencesRemoved.length === 1) {
    parts.push(`Removed ${formatShortDate(d.occurrencesRemoved[0].date, siteTz, locale)}`);
  } else if (d.occurrencesRemoved.length > 1) {
    parts.push(`${d.occurrencesRemoved.length} removed`);
  }
  return `${parts.join(', ')} · ${org}`;
}

function formatShortDate(naiveSiteLocal: string, siteTz: string, locale: string): string {
  // `naiveSiteLocal` is like '2026-04-27T18:00:00' — already projected into
  // siteTz by the parser. Render the date with Intl in the site's tz so the
  // output is identical for any admin regardless of their browser locale.
  const epochMs = Temporal.PlainDate.from(naiveSiteLocal.slice(0, 10))
    .toZonedDateTime({ timeZone: siteTz, plainTime: '12:00' })
    .epochMilliseconds;
  return new Intl.DateTimeFormat(locale, {
    timeZone: siteTz, month: 'short', day: 'numeric',
  }).format(epochMs);
}

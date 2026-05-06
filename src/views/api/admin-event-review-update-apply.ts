import type { APIContext } from 'astro';
import { z } from 'zod/v4';
import { authorize } from '../../lib/auth/authorize';
import { jsonResponse, jsonError } from '../../lib/api-response';
import { db } from '../../lib/get-db';
import { CITY } from '../../lib/config/config';
import { calendarFeedCache } from '../../lib/env/env.service';
import {
  advanceSnapshot,
  deleteSnapshot,
  computeExpiresAt,
} from '../../lib/calendar-suggestions/snapshots.server';
import { findVeventForPrefill } from '../../lib/calendar-suggestions/prefill';
import { loadAdminEventList } from '../../lib/content/load-admin-content.server';
import { saveContent } from '../../lib/content/content-save';
import { createEventHandlers } from './event-save';
import adminEventsVirtual from 'virtual:bike-app/admin-events';
import adminOrganizers from 'virtual:bike-app/admin-organizers';
import type { AdminEvent, AdminOrganizer } from '../../types/admin';
import type { ParsedVEvent, ParsedSeriesOverride } from '../../lib/calendar-suggestions/types';
import type { EventSeries } from '../../lib/models/event-model';
import type { Database } from '../../db';
import type { CalendarFeedCache } from '../../lib/calendar-feed-cache/feed-cache.service';
import type { SessionUser } from '../../lib/auth/auth';

export const prerender = false;

const togglePair = z.enum(['take', 'keep']);

export const bodySchema = z.object({
  master:        z.record(z.string(), togglePair).default({}),
  occurrences:   z.record(z.string(), z.object({
    takeAll: z.boolean(),
    fields:  z.record(z.string(), togglePair).optional(),
  })).default({}),
  additions:     z.record(z.string(), z.enum(['add', 'skip'])).default({}),
  cancellations: z.record(z.string(), z.enum(['mark', 'leave'])).default({}),
  removals:      z.record(z.string(), z.enum(['delete', 'keep'])).default({}),
  next:          z.enum(['back', 'editor']).default('back'),
});

export type ApplyBody = z.infer<typeof bodySchema>;

/**
 * Return the active occurrence array for a series: `schedule` for explicit-schedule
 * series, `overrides` for recurrence-rule series. Mutates are done on whichever is
 * populated; callers must re-assign if they replace the array entirely.
 */
function getOccurrenceArray(
  series: AdminEvent['series'],
): { key: 'schedule' | 'overrides'; items: Array<{ uid?: string; date: string; [k: string]: unknown }> } | null {
  if (!series) return null;
  if (series.schedule && series.schedule.length > 0) return { key: 'schedule', items: series.schedule };
  if (series.overrides) return { key: 'overrides', items: series.overrides };
  if (series.schedule) return { key: 'schedule', items: series.schedule };  // empty schedule still present
  return null;
}

// ---------------------------------------------------------------------------
// Addition classification helpers
// ---------------------------------------------------------------------------

export type AdditionTarget =
  | { kind: 'schedule_append'; entry: ParsedSeriesOverride }
  | { kind: 'season_extend'; newSeasonEnd: string }
  | { kind: 'override_append'; entry: ParsedSeriesOverride; bumpedSeasonEnd?: string }
  | { kind: 'skip'; reason: string };

/**
 * Returns true if `date` falls on a recurrence cycle that started at `seasonStart`
 * with the given `cadenceDays` interval, AND the date lands on `recurrenceDay`.
 */
export function isOnCycle(
  seasonStart: string,
  date: string,
  cadenceDays: number,
  recurrenceDay: string,
): boolean {
  const startMs = new Date(seasonStart + 'T00:00:00Z').getTime();
  const dateMs  = new Date(date + 'T00:00:00Z').getTime();
  if (dateMs < startMs) return false;
  const diffDays = Math.round((dateMs - startMs) / (24 * 3600 * 1000));
  if (diffDays % cadenceDays !== 0) return false;
  const dowMap: Record<string, number> = {
    sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
    thursday: 4, friday: 5, saturday: 6,
  };
  const expected = dowMap[recurrenceDay];
  if (expected === undefined) return false;
  const actual = new Date(dateMs).getUTCDay();
  return expected === actual;
}

/**
 * Classify how a single addition should be applied to a series.
 * Pure function — no side effects.
 */
export function classifyAddition(series: EventSeries, addition: ParsedSeriesOverride): AdditionTarget {
  // Schedule pattern
  if (series.schedule) {
    return { kind: 'schedule_append', entry: addition };
  }

  // Recurrence pattern
  if (series.recurrence_day) {
    const cadenceDays = series.recurrence === 'biweekly' ? 14 : 7;
    const seasonStart = series.season_start;
    const seasonEnd   = series.season_end;
    if (!seasonStart || !seasonEnd) {
      return { kind: 'skip', reason: 'recurrence series missing season bounds' };
    }

    const onCycle = isOnCycle(seasonStart, addition.date, cadenceDays, series.recurrence_day);
    if (onCycle) {
      if (addition.date > seasonEnd) {
        return { kind: 'season_extend', newSeasonEnd: addition.date };
      }
      return { kind: 'skip', reason: 'on-cycle date already within season window' };
    }

    // Off-cycle: append to overrides; bump season_end if past it.
    const bumpedSeasonEnd = addition.date > seasonEnd ? addition.date : undefined;
    return { kind: 'override_append', entry: addition, bumpedSeasonEnd };
  }

  return { kind: 'skip', reason: 'series has neither schedule nor recurrence_day' };
}

/**
 * Apply toggles to produce a patched copy of the repo event.
 * Returns a new object — does not mutate repoEvent.
 */
export function applyTogglesToEvent(
  repoEvent: AdminEvent,
  upstream: ParsedVEvent | null,
  body: ApplyBody,
): AdminEvent {
  // Deep-copy series so mutations don't bleed back to the original.
  const patched: AdminEvent = {
    ...repoEvent,
    series: repoEvent.series ? JSON.parse(JSON.stringify(repoEvent.series)) : undefined,
  };

  // --- Master fields ---
  if (upstream) {
    for (const [field, toggle] of Object.entries(body.master)) {
      if (toggle !== 'take') continue;

      if (field === 'start') {
        // 'start' is an ISO date-time; extract the date part for start_date
        patched.start_date = typeof upstream.start === 'string'
          ? upstream.start.slice(0, 10)
          : patched.start_date;
      } else if (field === 'end') {
        // 'end' is an ISO date-time; extract the date part for end_date
        patched.end_date = typeof upstream.end === 'string'
          ? upstream.end.slice(0, 10)
          : patched.end_date;
      } else if (field === 'summary') {
        patched.name = upstream.summary;
      } else if (field === 'location') {
        patched.location = upstream.location;
      } else if (field === 'url') {
        patched.event_url = upstream.url;
      } else if (field === 'registration_url') {
        patched.registration_url = upstream.registration_url;
      } else if (field === 'map_url') {
        patched.map_url = upstream.map_url;
      }
    }
  }

  // --- Per-occurrence changes ---
  if (upstream) {
    const upOverrides = upstream.series?.overrides ?? [];
    const occArr = getOccurrenceArray(patched.series);
    if (occArr) {
      for (const [uid, occ] of Object.entries(body.occurrences)) {
        if (!occ.takeAll) continue;
        const upOvr = upOverrides.find(o => o.uid === uid);
        if (!upOvr) continue;

        const repoIdx = occArr.items.findIndex(o => o.uid === uid);
        if (repoIdx !== -1) {
          occArr.items[repoIdx] = {
            ...occArr.items[repoIdx],
            ...(upOvr.start_time !== undefined ? { start_time: upOvr.start_time } : {}),
            ...(upOvr.location !== undefined ? { location: upOvr.location } : {}),
            ...(upOvr.cancelled !== undefined ? { cancelled: upOvr.cancelled } : {}),
            ...(upOvr.event_url !== undefined ? { event_url: upOvr.event_url } : {}),
            ...(upOvr.registration_url !== undefined ? { registration_url: upOvr.registration_url } : {}),
            ...(upOvr.map_url !== undefined ? { map_url: upOvr.map_url } : {}),
          };
        }
      }
    }
  }

  // --- Additions ---
  if (upstream) {
    const upOverrides = upstream.series?.overrides ?? [];
    for (const [uid, action] of Object.entries(body.additions)) {
      if (action !== 'add') continue;
      const upOvr = upOverrides.find(o => o.uid === uid);
      if (!upOvr) continue;

      if (!patched.series) continue;  // no series block to append to

      const addition: ParsedSeriesOverride = {
        date: upOvr.date,
        uid: upOvr.uid,
        ...(upOvr.start_time !== undefined ? { start_time: upOvr.start_time } : {}),
        ...(upOvr.location !== undefined ? { location: upOvr.location } : {}),
        ...(upOvr.event_url !== undefined ? { event_url: upOvr.event_url } : {}),
        ...(upOvr.registration_url !== undefined ? { registration_url: upOvr.registration_url } : {}),
        ...(upOvr.map_url !== undefined ? { map_url: upOvr.map_url } : {}),
      };

      const target = classifyAddition(patched.series, addition);

      switch (target.kind) {
        case 'schedule_append': {
          if (!patched.series.schedule!.find(o => o.uid === uid)) {
            patched.series.schedule!.push(target.entry);
          }
          // Advance season_end if the new date is later (schedule series may carry season_end)
          if (patched.series.season_end && target.entry.date > patched.series.season_end) {
            patched.series = { ...patched.series, season_end: target.entry.date };
          }
          break;
        }
        case 'season_extend': {
          patched.series = { ...patched.series, season_end: target.newSeasonEnd };
          break;
        }
        case 'override_append': {
          if (!patched.series.overrides) {
            patched.series = { ...patched.series, overrides: [] };
          }
          if (!patched.series.overrides!.find(o => o.uid === uid)) {
            patched.series.overrides!.push(target.entry);
          }
          if (target.bumpedSeasonEnd) {
            patched.series = { ...patched.series, season_end: target.bumpedSeasonEnd };
          }
          break;
        }
        case 'skip': {
          console.warn(`[applyTogglesToEvent] skipping addition uid=${uid}: ${target.reason}`);
          break;
        }
      }
    }
  }

  // --- Cancellations ---
  for (const [uid, action] of Object.entries(body.cancellations)) {
    if (action !== 'mark') continue;
    if (!patched.series) continue;

    const occArr = getOccurrenceArray(patched.series);
    if (!occArr) continue;

    const idx = occArr.items.findIndex(o => o.uid === uid);
    if (idx !== -1) {
      occArr.items[idx] = { ...occArr.items[idx], cancelled: true };
    } else {
      // Occurrence not yet in repo — create a minimal override with cancelled flag
      const upOverrides = upstream?.series?.overrides ?? [];
      const upOvr = upOverrides.find(o => o.uid === uid);
      if (upOvr) {
        occArr.items.push({ date: upOvr.date, uid: upOvr.uid, cancelled: true });
      }
    }
  }

  // --- Removals ---
  for (const [uid, action] of Object.entries(body.removals)) {
    if (action !== 'delete') continue;
    if (!patched.series) continue;

    const occArr = getOccurrenceArray(patched.series);
    if (!occArr) continue;

    const filtered = occArr.items.filter(o => o.uid !== uid);
    (patched.series as Record<string, unknown>)[occArr.key] = filtered;
  }

  return patched;
}

/**
 * Persist a patched event via the existing save pipeline.
 * Constructs a synthetic Request + minimal locals and delegates to saveContent.
 */
export async function persistPatchedEvent(
  patched: AdminEvent,
  user: SessionUser,
): Promise<void> {
  // Build the EventUpdate frontmatter from the patched AdminEvent.
  // Include all fields that event-save.ts's buildFileChanges knows about,
  // so the merge-with-existing logic in buildFileChanges can work correctly.
  const frontmatter: Record<string, unknown> = {
    name: patched.name,
    start_date: patched.start_date,
  };
  if (patched.end_date !== undefined) frontmatter.end_date = patched.end_date;
  if (patched.status !== undefined) frontmatter.status = patched.status;
  if (patched.location !== undefined) frontmatter.location = patched.location;
  if (patched.event_url !== undefined) frontmatter.event_url = patched.event_url;
  if (patched.map_url !== undefined) frontmatter.map_url = patched.map_url;
  if (patched.registration_url !== undefined) frontmatter.registration_url = patched.registration_url;
  if (patched.ics_uid !== undefined) frontmatter.ics_uid = patched.ics_uid;
  if (patched.organizer !== undefined) frontmatter.organizer = patched.organizer;
  if (patched.series !== undefined) frontmatter.series = patched.series;
  if (patched.tags !== undefined) frontmatter.tags = patched.tags;
  if (patched.past_slugs !== undefined) frontmatter.past_slugs = patched.past_slugs;
  if (patched.previous_event !== undefined) frontmatter.previous_event = patched.previous_event;
  if (patched.edition !== undefined) frontmatter.edition = patched.edition;
  if (patched.poster_key !== undefined) frontmatter.poster_key = patched.poster_key;
  if (patched.meet_time !== undefined) frontmatter.meet_time = patched.meet_time;
  if (patched.series_label !== undefined) frontmatter.series_label = patched.series_label;
  if (patched.is_series !== undefined) frontmatter.is_series = patched.is_series;
  if (patched.routes !== undefined) frontmatter.routes = patched.routes;

  const payload = {
    frontmatter,
    body: '',  // preserve existing body — buildFileChanges merges with existing
    slug: patched.slug,
  };

  const syntheticRequest = new Request('http://internal/api/synthetic', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const syntheticLocals = { user } as unknown as APIContext['locals'];
  const params = { id: patched.id };

  const handlers = createEventHandlers({}, calendarFeedCache, adminOrganizers);
  const { checkExistence: _ce, ...editHandlers } = handlers;
  const response = await saveContent(
    syntheticRequest,
    syntheticLocals,
    params,
    'events',
    editHandlers,
  );

  if (!response.ok) {
    const text = await response.text().catch(() => `status ${response.status}`);
    throw new Error(`persistPatchedEvent failed (${response.status}): ${text}`);
  }
}

/**
 * Core dispatch logic, extracted for testability.
 */
export async function dispatchApply(
  dbConn: Database,
  city: string,
  feedCache: CalendarFeedCache,
  organizers: Pick<AdminOrganizer, 'slug' | 'ics_url'>[],
  repoEvents: AdminEvent[],
  user: SessionUser,
  eventId: string,
  body: ApplyBody,
): Promise<{ redirectTo: string }> {
  const repoEvent = repoEvents.find(e => e.id === eventId);
  if (!repoEvent) {
    throw Object.assign(new Error('Event not found'), { httpStatus: 404 });
  }

  const orgSlug = repoEvent.organizer;
  if (typeof orgSlug !== 'string' || !repoEvent.ics_uid) {
    throw Object.assign(new Error('Event has no upstream link'), { httpStatus: 400 });
  }

  const orgIcsUrl = organizers.find(o => o.slug === orgSlug)?.ics_url;
  const cached    = orgIcsUrl ? await feedCache.get(orgSlug, orgIcsUrl) : null;
  const upstream  = cached ? (findVeventForPrefill(cached, repoEvent.ics_uid) ?? null) : null;

  const patched = applyTogglesToEvent(repoEvent, upstream, body);
  await persistPatchedEvent(patched, user);

  if (upstream) {
    await advanceSnapshot(
      dbConn, city, orgSlug, repoEvent.ics_uid,
      upstream, computeExpiresAt(repoEvent),
    );
  } else {
    await deleteSnapshot(dbConn, city, orgSlug, repoEvent.ics_uid);
  }

  const redirectTo = body.next === 'editor'
    ? `/admin/events/${encodeURIComponent(eventId)}`
    : '/admin/events';

  return { redirectTo };
}

export async function POST({ locals, params, request }: APIContext) {
  const user = authorize(locals, 'manage-calendar-suggestions');
  if (user instanceof Response) return user;

  // Decode %2F-encoded slashes — the route uses [id] (single segment) so the
  // event ID '2099/slug' is URL-encoded in the client fetch and must be decoded here.
  const eventId = decodeURIComponent((params.id ?? '') as string);
  if (!eventId) return jsonError('Missing event id', 400);

  let body: ApplyBody;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return jsonError('Bad request', 400);
  }

  try {
    const { events } = await loadAdminEventList(adminEventsVirtual);

    const repoEvent = events.find(e => e.id === eventId);
    if (!repoEvent) return jsonError('Event not found', 404);

    if (typeof repoEvent.organizer !== 'string' || !repoEvent.ics_uid) {
      return jsonError('Event has no upstream link', 400);
    }

    const { redirectTo } = await dispatchApply(
      db(), CITY, calendarFeedCache, adminOrganizers, events, user, eventId, body,
    );
    return jsonResponse({ ok: true, redirectTo });
  } catch (err: unknown) {
    const status = (err as { httpStatus?: number }).httpStatus;
    if (status === 404) return jsonError('Event not found', 404);
    if (status === 400) return jsonError('Event has no upstream link', 400);
    console.error('review-update apply error:', err);
    return jsonError('Failed to apply', 500);
  }
}

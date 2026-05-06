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
import type { ParsedVEvent } from '../../lib/calendar-suggestions/types';
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
 * Map a VEVENT field name to the AdminEvent / frontmatter field name.
 * The ICS VEVENT uses camelCase-ish names from the parsed types.
 * The repo uses its own set of field names.
 */
function upstreamFieldToRepoField(field: string): string {
  // MONITORED_MASTER_FIELDS: 'start', 'end', 'summary', 'location', 'cancelled', 'url', 'registration_url', 'map_url'
  switch (field) {
    case 'summary': return 'name';
    case 'url':     return 'event_url';
    case 'start':   return 'start_date';
    case 'end':     return 'end_date';
    default:        return field;  // location, cancelled, registration_url, map_url map 1:1
  }
}

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

      const upstreamVal = (upstream as unknown as Record<string, unknown>)[field];
      const repoField = upstreamFieldToRepoField(field);

      if (field === 'start') {
        // 'start' is an ISO date-time; extract the date part for start_date
        patched.start_date = typeof upstreamVal === 'string'
          ? upstreamVal.slice(0, 10)
          : patched.start_date;
      } else if (field === 'end') {
        // 'end' is an ISO date-time; extract the date part for end_date
        patched.end_date = typeof upstreamVal === 'string'
          ? upstreamVal.slice(0, 10)
          : patched.end_date;
      } else {
        (patched as unknown as Record<string, unknown>)[repoField] = upstreamVal;
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

      // Determine which array to append to; default to schedule for explicit-schedule series
      const occArr = getOccurrenceArray(patched.series);
      const arrayKey: 'schedule' | 'overrides' = occArr?.key ?? 'schedule';

      if (!patched.series[arrayKey]) {
        (patched.series as Record<string, unknown>)[arrayKey] = [];
      }
      const targetArr = patched.series[arrayKey]!;

      // Only append if not already present
      if (!targetArr.find(o => o.uid === uid)) {
        targetArr.push({
          date: upOvr.date,
          uid: upOvr.uid,
          ...(upOvr.start_time !== undefined ? { start_time: upOvr.start_time } : {}),
          ...(upOvr.location !== undefined ? { location: upOvr.location } : {}),
          ...(upOvr.event_url !== undefined ? { event_url: upOvr.event_url } : {}),
          ...(upOvr.registration_url !== undefined ? { registration_url: upOvr.registration_url } : {}),
          ...(upOvr.map_url !== undefined ? { map_url: upOvr.map_url } : {}),
        });
      }

      // Advance season_end if this occurrence is after it
      if (patched.series.season_end && upOvr.date > patched.series.season_end) {
        patched.series = { ...patched.series, season_end: upOvr.date };
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
  // Cast to record for fields not in the lightweight AdminEvent shape (location,
  // registration_url) that may be present at runtime after applyTogglesToEvent.
  const patchedRecord = patched as unknown as Record<string, unknown>;
  const frontmatter: Record<string, unknown> = {
    name: patched.name,
    start_date: patched.start_date,
  };
  if (patched.end_date !== undefined) frontmatter.end_date = patched.end_date;
  if (patched.status !== undefined) frontmatter.status = patched.status;
  if (patchedRecord.location !== undefined) frontmatter.location = patchedRecord.location;
  if (patched.event_url !== undefined) frontmatter.event_url = patched.event_url;
  if (patched.map_url !== undefined) frontmatter.map_url = patched.map_url;
  if (patchedRecord.registration_url !== undefined) frontmatter.registration_url = patchedRecord.registration_url;
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

  const eventId = (params.id ?? '') as string;
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

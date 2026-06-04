import type { APIContext } from 'astro';
import { z } from 'zod/v4';
import { authorize } from '../../lib/auth/authorize';
import { jsonResponse, jsonError } from '../../lib/api-response';
import { db } from '../../lib/get-db';
import { CITY } from '../../lib/config/config';
import { calendarFeedCache } from '../../lib/env/env.service';
import { dismissSuggestion } from '../../lib/calendar-suggestions/dismissals.server';
import {
  advanceSnapshot,
  deleteSnapshot,
  computeExpiresAt,
} from '../../lib/calendar-suggestions/snapshots.server';
import { findVeventForPrefill } from '../../lib/calendar-suggestions/prefill';
import { loadAdminEventList } from '../../lib/content/load-admin-content.server';
import type { CalendarFeedCache } from '../../lib/calendar-feed-cache/feed-cache.service';
import type { Database } from '../../db';
import type { AdminEvent, AdminOrganizer } from '../../types/admin';
import adminOrganizers from 'virtual:bike-app/admin-organizers';
import adminEventsVirtual from 'virtual:bike-app/admin-events';

export const prerender = false;

const importBody = z.object({
  kind:           z.literal('import').optional().default('import'),
  organizer_slug: z.string().min(1),
  uid:            z.string().min(1),
  valid_until:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD'),
});

const reviewBody = z.object({
  kind:           z.literal('review'),
  organizer_slug: z.string().min(1),
  uid:            z.string().min(1),
  event_id:       z.string().min(1),
});

const bodySchema = z.discriminatedUnion('kind', [importBody, reviewBody]);

export type DismissBody = z.infer<typeof bodySchema>;

/**
 * Core dispatch logic, extracted for testability. Handles both `import` and
 * `review` dismiss payloads.
 *
 * - `import`: writes a dismissal record (existing behaviour).
 * - `review`: advances the snapshot to the current upstream state (if the VEVENT
 *   is still in the feed) or deletes the snapshot row (if the event has been
 *   removed upstream). Does NOT write to the dismissals table.
 */
export async function dispatchDismiss(
  dbConn: Database,
  city: string,
  feedCache: CalendarFeedCache,
  organizers: Pick<AdminOrganizer, 'slug' | 'ics_url'>[],
  repoEvents: Array<Pick<AdminEvent, 'id' | 'start_date' | 'end_date' | 'series'>>,
  body: DismissBody,
): Promise<void> {
  if (body.kind === 'review') {
    const orgIcsUrl = organizers.find(o => o.slug === body.organizer_slug)?.ics_url;
    const cached = orgIcsUrl
      ? await feedCache.get(body.organizer_slug, orgIcsUrl)
      : null;
    const upstream = cached ? (findVeventForPrefill(cached, body.uid) ?? null) : null;

    if (upstream) {
      const repoEvent = repoEvents.find(e => e.id === body.event_id);
      // Repo event not found — defensive: keep snapshot indefinitely until next list-build resolves it.
      const expiresAt = repoEvent ? computeExpiresAt(repoEvent) : '9999-12-31';
      await advanceSnapshot(dbConn, city, body.organizer_slug, body.uid, upstream, expiresAt);
    } else {
      // VEVENT no longer in feed (or feed not cached) — remove the snapshot.
      await deleteSnapshot(dbConn, city, body.organizer_slug, body.uid);
    }
  } else {
    await dismissSuggestion(dbConn, city, body.organizer_slug, body.uid, body.valid_until);
  }
}

export async function POST({ locals, request }: APIContext) {
  const user = authorize(locals, 'manage-calendar-suggestions');
  if (user instanceof Response) return user;

  let body: DismissBody;
  try {
    const json = await request.json();
    // Backward-compat: payload without `kind` defaults to 'import'.
    if (json && typeof json === 'object' && !('kind' in json)) {
      (json as Record<string, unknown>).kind = 'import';
    }
    body = bodySchema.parse(json);
  } catch {
    return jsonError('Bad request', 400);
  }

  try {
    const { events: repoEvents } = await loadAdminEventList(adminEventsVirtual);
    await dispatchDismiss(db(), CITY, calendarFeedCache, adminOrganizers, repoEvents, body);
    return jsonResponse({ ok: true });
  } catch (err: unknown) {
    console.error('calendar suggestion dismiss error:', err);
    return jsonError('Failed to dismiss', 500);
  }
}

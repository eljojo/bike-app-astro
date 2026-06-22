import { and, eq, gte } from 'drizzle-orm';
import type { Database } from '../../db';
import { calendarEventSnapshots } from '../../db/schema';
import type { ParsedVEvent } from './types';

export const NEVER_EXPIRES = '9999-12-31';

/**
 * A minimal series shape that `computeExpiresAt` needs to inspect. Covers
 * both `ParsedSeries` (which has `kind`) and `EventSeries` (which uses
 * `recurrence`/`schedule` directly) via the union of their relevant fields.
 */
interface SeriesExpiryShape {
  kind?: string;
  season_end?: string;
  schedule?: Array<{ date: string }>;
}

/**
 * Persist (or update) a snapshot of a calendar VEVENT as it exists right now.
 * Idempotent on the composite PK (city, organizer_slug, uid) — a second call
 * for the same key overwrites `snapshot_json`, `snapshotted_at`, and
 * `expires_at` so the record always reflects the most-recent known state.
 */
export async function advanceSnapshot(
  db: Database,
  city: string,
  organizerSlug: string,
  uid: string,
  current: ParsedVEvent,
  expiresAt: string,
  snapshottedAt: string = new Date().toISOString(),
): Promise<void> {
  await db.insert(calendarEventSnapshots)
    .values({
      city, organizerSlug, uid,
      snapshotJson:  JSON.stringify(current),
      snapshottedAt,
      expiresAt,
    })
    .onConflictDoUpdate({
      target: [
        calendarEventSnapshots.city,
        calendarEventSnapshots.organizerSlug,
        calendarEventSnapshots.uid,
      ],
      set: {
        snapshotJson:  JSON.stringify(current),
        snapshottedAt,
        expiresAt,
      },
    })
    .run();
}

/**
 * Return all non-expired snapshots for `city` as a keyed Map.
 * Keys are `${organizer_slug}:${uid}` — same convention as dismissals.
 * Rows whose `expires_at < todayLocalDate` are excluded by the DB predicate.
 */
export async function loadAllSnapshots(
  db: Database,
  city: string,
  todayLocalDate: string,
): Promise<Map<string, ParsedVEvent>> {
  const rows = await db.select({
      organizer_slug: calendarEventSnapshots.organizerSlug,
      uid:            calendarEventSnapshots.uid,
      snapshot_json:  calendarEventSnapshots.snapshotJson,
    })
    .from(calendarEventSnapshots)
    .where(and(
      eq(calendarEventSnapshots.city, city),
      gte(calendarEventSnapshots.expiresAt, todayLocalDate),
    ));
  const out = new Map<string, ParsedVEvent>();
  for (const r of rows) {
    try {
      out.set(`${r.organizer_slug}:${r.uid}`, JSON.parse(r.snapshot_json) as ParsedVEvent);
    } catch (err) {
      console.warn(`snapshot JSON parse failed for ${r.organizer_slug}:${r.uid}:`, err);
    }
  }
  return out;
}

/**
 * Return the snapshot for a single `(city, organizer_slug, uid)` triple, or
 * `null` if none exists. Unlike `loadAllSnapshots`, this function does NOT
 * filter by `expires_at` — the review page wants to render a diff even when
 * the snapshot's expiry has passed, because the user is explicitly viewing
 * this event right now.
 */
export async function loadOneSnapshot(
  db: Database,
  city: string,
  organizerSlug: string,
  uid: string,
): Promise<ParsedVEvent | null> {
  const rows = await db.select({
      snapshot_json: calendarEventSnapshots.snapshotJson,
    })
    .from(calendarEventSnapshots)
    .where(and(
      eq(calendarEventSnapshots.city, city),
      eq(calendarEventSnapshots.organizerSlug, organizerSlug),
      eq(calendarEventSnapshots.uid, uid),
    ))
    .limit(1);
  if (rows.length === 0) return null;
  try {
    return JSON.parse(rows[0].snapshot_json) as ParsedVEvent;
  } catch (err) {
    console.warn(`snapshot JSON parse failed for ${organizerSlug}:${uid}:`, err);
    return null;
  }
}

/**
 * Remove the snapshot for `(city, organizer_slug, uid)`. Used when an event
 * is imported — the snapshot is no longer needed as a suggestion source.
 */
export async function deleteSnapshot(
  db: Database,
  city: string,
  organizerSlug: string,
  uid: string,
): Promise<void> {
  await db.delete(calendarEventSnapshots)
    .where(and(
      eq(calendarEventSnapshots.city, city),
      eq(calendarEventSnapshots.organizerSlug, organizerSlug),
      eq(calendarEventSnapshots.uid, uid),
    ))
    .run();
}

/**
 * Compute the `expires_at` date string for a snapshot given an event shape.
 *
 * Rules (in priority order):
 *  1. No `series` field → one-off; use `end_date` if present, else `start_date`.
 *  2. Series with `season_end` (recurrence pattern) → `season_end`.
 *  3. Series with `schedule[]` → max date in the schedule array.
 *  4. Unbounded series (no season_end, no schedule) → `NEVER_EXPIRES`.
 */
export function computeExpiresAt(
  e: { start_date?: string; end_date?: string; series?: SeriesExpiryShape },
): string {
  if (e.series) {
    if (e.series.season_end) return e.series.season_end;
    if (e.series.schedule && e.series.schedule.length > 0) {
      let max = e.series.schedule[0].date;
      for (const s of e.series.schedule) if (s.date > max) max = s.date;
      return max;
    }
    return NEVER_EXPIRES;
  }
  return e.end_date ?? e.start_date ?? NEVER_EXPIRES;
}

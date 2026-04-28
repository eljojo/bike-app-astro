import { and, eq, gte } from 'drizzle-orm';
import type { Database } from '../../db';
import { calendarSuggestionDismissals } from '../../db/schema';

/**
 * Date string (YYYY-MM-DD) used when a dismissal has no natural expiry — an
 * unbounded recurrence series, or any case where the producer wants the
 * dismissal to persist until manually undismissed.
 */
export const NEVER_EXPIRES = '9999-12-31';

/**
 * Return the keyed Set of dismissals for `city` whose `valid_until >= today`.
 * Single SELECT, no IN-clause — the date predicate naturally filters out
 * dismissals for events that have already passed, so the working set is
 * bounded by "still-relevant dismissals" rather than the cumulative history.
 *
 * Set values are `${organizer_slug}:${uid}` so callers can look up dismissals
 * scoped per-organizer (two feeds with the same UID string don't collide).
 */
export async function listDismissedKeys(
  db: Database,
  city: string,
  todayLocalDate: string,
): Promise<Set<string>> {
  const rows = await db.select({
      organizer_slug: calendarSuggestionDismissals.organizerSlug,
      uid:            calendarSuggestionDismissals.uid,
    })
    .from(calendarSuggestionDismissals)
    .where(and(
      eq(calendarSuggestionDismissals.city, city),
      gte(calendarSuggestionDismissals.validUntil, todayLocalDate),
    ));
  const out = new Set<string>();
  for (const r of rows) out.add(`${r.organizer_slug}:${r.uid}`);
  return out;
}

/**
 * Mark `(city, organizer_slug, uid)` as dismissed until `validUntil` (a
 * YYYY-MM-DD). Idempotent on the PK — re-dismissing updates the date so a
 * suggestion that re-appears later (e.g. extended season) gets a refreshed
 * lifetime instead of being lost.
 */
export async function dismissSuggestion(
  db: Database,
  city: string,
  organizerSlug: string,
  uid: string,
  validUntil: string,
): Promise<void> {
  await db.insert(calendarSuggestionDismissals)
    .values({ city, organizerSlug, uid, validUntil })
    .onConflictDoUpdate({
      target: [
        calendarSuggestionDismissals.city,
        calendarSuggestionDismissals.organizerSlug,
        calendarSuggestionDismissals.uid,
      ],
      set: { validUntil },
    })
    .run();
}

/**
 * Remove a dismissal record (restore the UID to suggestions). Not currently wired into
 * any UI; kept here so a future "Dismissed suggestions" admin view can use it.
 */
export async function undismissSuggestion(
  db: Database,
  city: string,
  organizerSlug: string,
  uid: string,
): Promise<void> {
  await db.delete(calendarSuggestionDismissals)
    .where(and(
      eq(calendarSuggestionDismissals.city, city),
      eq(calendarSuggestionDismissals.organizerSlug, organizerSlug),
      eq(calendarSuggestionDismissals.uid, uid),
    ))
    .run();
}

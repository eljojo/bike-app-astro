import { and, eq, gte } from 'drizzle-orm';
import type { Database } from '../../db';
import { calendarSuggestionDismissals } from '../../db/schema';

/**
 * Date string (YYYY-MM-DD) used when a dismissal has no natural expiry — an
 * unbounded recurrence series, or any case where the producer wants the
 * dismissal to persist until manually undismissed.
 */
export const NEVER_EXPIRES = '9999-12-31';

export interface DismissalRecord {
  /** ISO-8601 UTC timestamp of when the dismissal was recorded. */
  dismissed_at: string;
}

/**
 * Return the keyed Map of dismissals for `city` whose `valid_until >= today`.
 * Single SELECT, no IN-clause — the date predicate naturally filters out
 * dismissals for events that have already passed, so the working set is
 * bounded by "still-relevant dismissals" rather than the cumulative history.
 *
 * Map keys are `${organizer_slug}:${uid}` so callers can look up dismissals
 * scoped per-organizer (two feeds with the same UID string don't collide).
 * Values carry `dismissed_at` so the suggestion filter can ignore a dismissal
 * whose source VEVENT has been updated since.
 */
export async function listDismissedKeys(
  db: Database,
  city: string,
  todayLocalDate: string,
): Promise<Map<string, DismissalRecord>> {
  const rows = await db.select({
      organizer_slug: calendarSuggestionDismissals.organizerSlug,
      uid:            calendarSuggestionDismissals.uid,
      dismissed_at:   calendarSuggestionDismissals.dismissedAt,
    })
    .from(calendarSuggestionDismissals)
    .where(and(
      eq(calendarSuggestionDismissals.city, city),
      gte(calendarSuggestionDismissals.validUntil, todayLocalDate),
    ));
  const out = new Map<string, DismissalRecord>();
  for (const r of rows) out.set(`${r.organizer_slug}:${r.uid}`, { dismissed_at: r.dismissed_at });
  return out;
}

/**
 * Mark `(city, organizer_slug, uid)` as dismissed until `validUntil` (a
 * YYYY-MM-DD). Idempotent on the PK — re-dismissing updates the date and
 * refreshes `dismissed_at`, so a feed update later than the new timestamp can
 * still invalidate the dismissal.
 */
export async function dismissSuggestion(
  db: Database,
  city: string,
  organizerSlug: string,
  uid: string,
  validUntil: string,
  dismissedAt: string = new Date().toISOString(),
): Promise<void> {
  await db.insert(calendarSuggestionDismissals)
    .values({ city, organizerSlug, uid, validUntil, dismissedAt })
    .onConflictDoUpdate({
      target: [
        calendarSuggestionDismissals.city,
        calendarSuggestionDismissals.organizerSlug,
        calendarSuggestionDismissals.uid,
      ],
      set: { validUntil, dismissedAt },
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

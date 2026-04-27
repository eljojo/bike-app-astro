import { and, eq, inArray } from 'drizzle-orm';
import type { Database } from '../../db';
import { calendarSuggestionDismissals } from '../../db/schema';

export interface DismissalKey {
  organizer_slug: string;
  uid: string;
}

/**
 * Single SELECT WHERE city = ? AND uid IN (...). Returns a Set keyed by
 * `${organizer_slug}:${uid}` so the caller can match per-organizer dismissals
 * without sending tuple-IN (D1 doesn't support `(col, col) IN ((?, ?), ...)`).
 *
 * Empty `candidates` short-circuits to an empty Set without querying D1; this is
 * the common path on a city that has no organizers with `ics_url` configured.
 *
 * Cost is bounded by `candidates.length` rows, so the dismissals table can grow
 * without inflating per-request cost — every page load reads at most O(suggestion
 * candidates) rows, never the full dismissal history.
 */
export async function listDismissedKeys(
  db: Database,
  city: string,
  candidates: DismissalKey[],
): Promise<Set<string>> {
  if (candidates.length === 0) return new Set();
  const uids = Array.from(new Set(candidates.map(c => c.uid)));
  const rows = await db.select({
      organizer_slug: calendarSuggestionDismissals.organizerSlug,
      uid:            calendarSuggestionDismissals.uid,
    })
    .from(calendarSuggestionDismissals)
    .where(and(
      eq(calendarSuggestionDismissals.city, city),
      inArray(calendarSuggestionDismissals.uid, uids),
    ));
  // Build the Set scoped to the actual (organizer_slug, uid) candidates — a row
  // sharing only a UID with a candidate (different organizer) must not match.
  const candidateKeys = new Set(candidates.map(c => `${c.organizer_slug}:${c.uid}`));
  const out = new Set<string>();
  for (const r of rows) {
    const key = `${r.organizer_slug}:${r.uid}`;
    if (candidateKeys.has(key)) out.add(key);
  }
  return out;
}

/** Mark `(city, organizer_slug, uid)` as dismissed. Idempotent. */
export async function dismissSuggestion(
  db: Database,
  city: string,
  organizerSlug: string,
  uid: string,
): Promise<void> {
  await db.insert(calendarSuggestionDismissals)
    .values({ city, organizerSlug, uid })
    .onConflictDoNothing()
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

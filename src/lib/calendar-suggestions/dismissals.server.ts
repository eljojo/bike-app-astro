import { and, eq } from 'drizzle-orm';
import type { Database } from '../../db';
import { calendarSuggestionDismissals } from '../../db/schema';

/**
 * Return the set of ICS event UIDs that an admin has dismissed for `city`.
 * Used to filter suggestions at build time.
 */
export async function listDismissedUids(db: Database, city: string): Promise<Set<string>> {
  const rows = await db.select({ uid: calendarSuggestionDismissals.uid })
    .from(calendarSuggestionDismissals)
    .where(eq(calendarSuggestionDismissals.city, city));
  return new Set(rows.map(r => r.uid));
}

/**
 * Mark `uid` as dismissed for `city`. Idempotent — re-dismissing is a no-op.
 */
export async function dismissSuggestion(db: Database, city: string, uid: string): Promise<void> {
  await db.insert(calendarSuggestionDismissals)
    .values({ city, uid })
    .onConflictDoNothing()
    .run();
}

/**
 * Remove a dismissal record (restore the UID to suggestions). Not currently wired into
 * any UI; kept here so a future "Dismissed suggestions" admin view can use it.
 */
export async function undismissSuggestion(db: Database, city: string, uid: string): Promise<void> {
  await db.delete(calendarSuggestionDismissals)
    .where(and(
      eq(calendarSuggestionDismissals.city, city),
      eq(calendarSuggestionDismissals.uid, uid),
    ))
    .run();
}

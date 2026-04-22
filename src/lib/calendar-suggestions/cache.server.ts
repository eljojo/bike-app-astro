import { and, eq, sql } from 'drizzle-orm';
import type { Database } from '../../db';
import { calendarFeedCache, calendarSuggestionDismissals } from '../../db/schema';
import type { ParsedFeed } from './types';

const FEED_TTL_MS = 60 * 60 * 1000; // 1 hour

export async function readCachedFeed(
  db: Database,
  slug: string,
  expectedSourceUrl?: string,
): Promise<ParsedFeed | null> {
  const rows = await db.select().from(calendarFeedCache)
    .where(eq(calendarFeedCache.organizerSlug, slug))
    .limit(1);
  if (rows.length === 0) return null;
  const row = rows[0];
  // Treat a URL mismatch as stale — the organizer repointed their ICS feed
  // and the cached blob is from the old source.
  if (expectedSourceUrl !== undefined && row.sourceUrl !== expectedSourceUrl) return null;
  const age = Date.now() - new Date(row.updatedAt).getTime();
  if (age > FEED_TTL_MS) return null;
  try {
    return JSON.parse(row.eventsJson) as ParsedFeed;
  } catch {
    return null;
  }
}

export async function writeCachedFeed(
  db: Database,
  slug: string,
  sourceUrl: string,
  feed: ParsedFeed,
): Promise<void> {
  const now = new Date().toISOString();
  await db.insert(calendarFeedCache)
    .values({
      organizerSlug: slug,
      sourceUrl,
      eventsJson: JSON.stringify(feed),
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: calendarFeedCache.organizerSlug,
      set: {
        sourceUrl: sql`excluded.source_url`,
        eventsJson: sql`excluded.events_json`,
        updatedAt: sql`excluded.updated_at`,
      },
    })
    .run();
}

// --- dismissals ---

export async function listDismissedUids(db: Database, city: string): Promise<Set<string>> {
  const rows = await db.select({ uid: calendarSuggestionDismissals.uid })
    .from(calendarSuggestionDismissals)
    .where(eq(calendarSuggestionDismissals.city, city));
  return new Set(rows.map(r => r.uid));
}

export async function dismissSuggestion(
  db: Database,
  city: string,
  uid: string,
  organizerSlug: string,
  dismissedBy: string,
  snapshot?: { name: string; start: string },
): Promise<void> {
  const now = new Date().toISOString();
  // First dismissal wins: preserves the original dismisser/timestamp/snapshot
  // even if another admin re-dismisses the same (city, uid) later. The filter
  // semantics only care whether a row exists.
  await db.insert(calendarSuggestionDismissals)
    .values({
      city, uid, organizerSlug,
      dismissedAt: now,
      dismissedBy,
      eventSnapshotJson: snapshot ? JSON.stringify(snapshot) : null,
    })
    .onConflictDoNothing()
    .run();
}

export async function undismissSuggestion(db: Database, city: string, uid: string): Promise<void> {
  await db.delete(calendarSuggestionDismissals)
    .where(and(
      eq(calendarSuggestionDismissals.city, city),
      eq(calendarSuggestionDismissals.uid, uid),
    ))
    .run();
}

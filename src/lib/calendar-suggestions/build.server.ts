import { listDismissedUids } from './dismissals.server';
import type { ParsedFeed, ParsedSeries, ParsedVEvent, Suggestion } from './types';
import type { AdminEvent, AdminOrganizer } from '../../types/admin';
import type { Database } from '../../db';
import type { CalendarFeedCache } from '../calendar-feed-cache/feed-cache.service';

const HORIZON_DAYS = 180;
const MAX_ITEMS = 10;
const FEED_TTL_SECONDS = 60 * 60;  // 1 hour

export type { Suggestion };

export interface BuildArgs {
  db: Database;
  city: string;
  organizers: Array<Pick<AdminOrganizer, 'slug' | 'name' | 'ics_url'>>;
  repoEvents: Array<Pick<AdminEvent, 'id' | 'slug' | 'year' | 'name' | 'start_date' | 'ics_uid' | 'organizer'>>;
  feedCache: CalendarFeedCache;
  /**
   * Required. Caller binds `siteTz` (and any other context the parser needs)
   * into a closure so build.server.ts stays decoupled from city config and
   * from `fetchIcsFeed`'s evolving signature.
   */
  fetcher: (url: string) => Promise<ParsedFeed>;
  now?: Date;
}

/**
 * Pure core. Builds the suggestion list from organizer feeds, hiding anything
 * already in the repo (UID match; for one-offs, also organizer+date match) or
 * previously dismissed.
 *
 * Feed data is read/written via the injected `feedCache` (KV in prod, filesystem
 * in local dev). Dismissals are read from D1 via `listDismissedUids`.
 *
 * Planned: extend to surface UID-matched repo events whose fields differ from
 * the upstream VEVENT ("updated suggestions"). See
 * ~/code/bike-app/docs/plans/2026-04-21-calendar-suggestions-design.md under
 * Future work.
 */
export async function buildSuggestions(args: BuildArgs): Promise<Suggestion[]> {
  const { db, city, organizers, repoEvents, feedCache, fetcher } = args;
  const now = args.now ?? new Date();

  const withFeed = organizers.filter(o => o.ics_url);

  const repoUids = new Set(repoEvents.flatMap(e => e.ics_uid ? [e.ics_uid] : []));
  const repoOrgDates = new Set(
    repoEvents.flatMap(e => {
      // Inline organizer objects skip the org+date fallback (rare ad-hoc hosts).
      const slug = typeof e.organizer === 'string' ? e.organizer : undefined;
      return slug && e.start_date ? [`${slug}:${e.start_date}`] : [];
    }),
  );

  const dismissedUids = await listDismissedUids(db, city);

  const feeds = await Promise.allSettled(withFeed.map(async o => {
    const cached = await feedCache.get(o.slug, o.ics_url!);
    if (cached) return { slug: o.slug, name: o.name, feed: cached };
    const feed = await fetcher(o.ics_url!);
    // Cache write is best-effort — a KV hiccup must not throw away a successful parse.
    // The feed is still returned; the next pageload will try the cache write again.
    try {
      await feedCache.put(o.slug, o.ics_url!, feed, FEED_TTL_SECONDS);
    } catch (err) {
      console.warn(`calendar feed cache write failed for ${o.slug}:`, err);
    }
    return { slug: o.slug, name: o.name, feed };
  }));

  const horizon = new Date(now.getTime() + HORIZON_DAYS * 24 * 3600 * 1000);
  const nowDate = now.toISOString().slice(0, 10);  // 'YYYY-MM-DD' for date-only comparisons

  function isAlreadyInRepo(slug: string, e: ParsedVEvent): boolean {
    if (repoUids.has(e.uid)) return true;
    if (e.series) return false;                       // series: UID-only, no org+date fallback
    const startDate = e.start.slice(0, 10);
    return repoOrgDates.has(`${slug}:${startDate}`);
  }

  function isInWindow(e: ParsedVEvent): boolean {
    if (new Date(e.start) > horizon) return false;   // too far out — always applies
    if (!e.series) {
      // One-off: include if it hasn't ended yet.
      const endOrStart = new Date(e.end ?? e.start);
      return endOrStart >= now;
    }
    if (e.series.kind === 'recurrence') {
      // Recurrence series: active if season_end hasn't passed.
      return !e.series.season_end || e.series.season_end >= nowDate;
    }
    // Schedule series: active if any scheduled date is still upcoming.
    return (e.series.schedule ?? []).some(s => s.date >= nowDate);
  }

  const suggestions: Suggestion[] = feeds.flatMap(r => {
    if (r.status !== 'fulfilled') return [];
    return r.value.feed.events
      .filter(e => !isAlreadyInRepo(r.value.slug, e))
      .filter(e => !dismissedUids.has(e.uid))
      .filter(isInWindow)
      .map((e): Suggestion => ({
        uid: e.uid,
        kind: e.series ? 'series' : 'one-off',
        organizer_slug: r.value.slug,
        organizer_name: r.value.name,
        name: e.summary,
        start: e.start,
        location: e.location,
        series_label: e.series ? formatSeriesLabel(e.series) : undefined,
      }));
  });

  suggestions.sort((a, b) => a.start.localeCompare(b.start));
  return suggestions.slice(0, MAX_ITEMS);
}

export function formatSeriesLabel(s: ParsedSeries): string {
  if (s.kind === 'recurrence' && s.recurrence && s.recurrence_day) {
    const day = s.recurrence_day[0].toUpperCase() + s.recurrence_day.slice(1);
    return s.recurrence === 'biweekly' ? `Every other ${day}` : `Every ${day}`;
  }
  if (s.kind === 'schedule' && s.schedule) return `${s.schedule.length} dates`;
  return 'Series';
}

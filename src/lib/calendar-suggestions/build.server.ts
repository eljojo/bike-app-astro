import { Temporal } from '@js-temporal/polyfill';
import { listDismissedKeys, NEVER_EXPIRES } from './dismissals.server';
import { revalidateClusterAfterTrim } from './detect-implicit-series';
import type { ParsedFeed, ParsedSeries, ParsedVEvent, RecurrenceDay, Suggestion } from './types';
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
  repoEvents: Array<Pick<AdminEvent, 'id' | 'slug' | 'year' | 'name' | 'start_date' | 'ics_uid' | 'organizer' | 'series'>>;
  feedCache: CalendarFeedCache;
  /**
   * Required. Caller binds `siteTz` (and any other context the parser needs)
   * into a closure so build.server.ts stays decoupled from city config and
   * from `fetchIcsFeed`'s evolving signature.
   */
  fetcher: (url: string) => Promise<ParsedFeed>;
  /**
   * Site IANA timezone. Used to project `now` into the same naive site-local
   * clock as the parser's output, so window/season comparisons can be string
   * comparisons against the naive datetimes the parser emits. Without this,
   * `new Date(e.start)` on Workers (UTC) reads naive site-local strings as
   * UTC and shifts events by the city offset, dropping currently-happening
   * events in westward cities.
   */
  siteTz: string;
  now?: Date;
}

/**
 * Pure core. Builds the suggestion list from organizer feeds, hiding anything
 * already in the repo (UID match; for one-offs, also organizer+date match) or
 * previously dismissed.
 *
 * Feed data is read/written via the injected `feedCache` (KV in prod, filesystem
 * in local dev). Dismissals are read from D1 via `listDismissedKeys` — a single
 * SELECT filtered by `valid_until >= today`, so per-request cost is bounded by
 * the count of dismissals whose underlying event hasn't passed yet.
 *
 * Planned: extend to surface UID-matched repo events whose fields differ from
 * the upstream VEVENT ("updated suggestions"). See
 * ~/code/bike-app/docs/plans/2026-04-21-calendar-suggestions-design.md under
 * Future work.
 *
 * Also planned (slots into the same "updated suggestions" surface): auto-extend
 * an imported implicit series when the feed grows beyond its season_end. When
 * a fresh feed pull contains occurrences past the imported event's season_end
 * that match its modal DOW + cadence (and gap from season_end ≤ 60d), surface
 * an admin-confirmable "extend series" suggestion that appends those
 * occurrences as overrides and updates season_end. The per-occurrence `uid`
 * field on series.overrides — added by the implicit-series-detection feature —
 * is the prerequisite that lets dedupe absorb the extension cleanly. See
 * ~/code/bike-app/docs/plans/2026-04-28-implicit-series-detection-design.md
 * under Future work.
 */
export async function buildSuggestions(args: BuildArgs): Promise<Suggestion[]> {
  const { db, city, organizers, repoEvents, feedCache, fetcher, siteTz } = args;
  const now = args.now ?? new Date();
  const nowZdt = Temporal.Instant.fromEpochMilliseconds(now.getTime()).toZonedDateTimeISO(siteTz);
  const nowLocal = nowZdt.toPlainDateTime().toString({ smallestUnit: 'second' });
  const nowLocalDate = nowZdt.toPlainDate().toString();
  const horizonLocal = nowZdt.add({ days: HORIZON_DAYS })
    .toPlainDateTime().toString({ smallestUnit: 'second' });

  const withFeed = organizers.filter(o => o.ics_url);

  // Includes BOTH the top-level `ics_uid` AND each per-occurrence override
  // UID. Without the override UIDs, a partially-imported series would
  // re-suggest its non-overlapping occurrences as one-offs (Task 8).
  const repoUids = new Set(repoEvents.flatMap(e => {
    const top = e.ics_uid ? [e.ics_uid] : [];
    const overrides = e.series?.overrides?.flatMap(o => o.uid ? [o.uid] : []) ?? [];
    return [...top, ...overrides];
  }));
  const repoOrgDates = new Set(
    repoEvents.flatMap(e => {
      // Inline organizer objects skip the org+date fallback (rare ad-hoc hosts).
      const slug = typeof e.organizer === 'string' ? e.organizer : undefined;
      return slug && e.start_date ? [`${slug}:${e.start_date}`] : [];
    }),
  );

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

  function isAlreadyInRepo(slug: string, e: ParsedVEvent): boolean {
    if (repoUids.has(e.uid)) return true;
    if (e.series) return false;                       // series: UID-only, no org+date fallback
    const startDate = e.start.slice(0, 10);
    return repoOrgDates.has(`${slug}:${startDate}`);
  }

  function isInWindow(e: ParsedVEvent): boolean {
    // Lex comparison against naive site-local clock strings. The parser emits
    // `start`/`end` as `YYYY-MM-DDTHH:MM:SS` already projected into siteTz, so
    // string ordering matches chronological ordering. Avoids `new Date(naive)`,
    // which interprets in the *server*'s TZ (UTC on Workers) and shifts the
    // comparison by the city's offset.
    if (e.start > horizonLocal) return false;        // too far out
    if (!e.series) {
      const endOrStart = e.end ?? e.start;
      return endOrStart >= nowLocal;                  // one-off: include while not ended
    }
    if (e.series.kind === 'recurrence') {
      return !e.series.season_end || e.series.season_end >= nowLocalDate;
    }
    return (e.series.schedule ?? []).some(s => s.date >= nowLocalDate);
  }

  // Dismissals query is independent of the candidate set — bounded only by
  // dismissals whose underlying event hasn't passed yet. Run it in parallel
  // with the per-feed processing.
  const dismissedPromise = listDismissedKeys(db, city, nowLocalDate);

  type Candidate = { sortKey: string; suggestion: Suggestion };
  const candidates: Candidate[] = feeds.flatMap(r => {
    if (r.status !== 'fulfilled') return [];
    return r.value.feed.events
      // Bypass top-level isAlreadyInRepo for series WITH per-occurrence
      // overrides, so trimSeriesAgainstRepo can re-evaluate partial overlap.
      // (revalidateClusterAfterTrim correctly handles the case where the
      // master uid is in repoUids: it removes that occurrence and re-emits the
      // surviving subset, which may or may not still cluster.) Pure RRULE
      // series with no overrides keep the original top-level dedupe.
      .filter(e =>
        (e.series && e.series.kind === 'recurrence' && (e.series.overrides?.length ?? 0) > 0)
          ? true
          : !isAlreadyInRepo(r.value.slug, e),
      )
      .flatMap(e => trimSeriesAgainstRepo(e, repoUids, siteTz))
      // After trim, dissolved-cluster outputs may include one-offs that need
      // to be checked against repoUids/repoOrgDates. Surviving series carry
      // their original master uid by design, so this catches dissolved
      // one-offs colliding with unrelated repo entries on org+date.
      .filter(e => e.series ? true : !isAlreadyInRepo(r.value.slug, e))
      .filter(isInWindow)
      .map((e): Candidate => ({
        sortKey: nextOccurrenceSortKey(e, nowLocalDate),
        suggestion: {
          uid: e.uid,
          kind: e.series ? 'series' : 'one-off',
          organizer_slug: r.value.slug,
          organizer_name: r.value.name,
          name: e.summary,
          start: e.start,
          location: e.location,
          series_label: e.series ? formatSeriesLabel(e.series) : undefined,
          valid_until: validUntilForEvent(e),
        },
      }));
  });

  const dismissed = await dismissedPromise;
  const visible = candidates.filter(c =>
    !dismissed.has(`${c.suggestion.organizer_slug}:${c.suggestion.uid}`),
  );
  visible.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  return visible.slice(0, MAX_ITEMS).map(c => c.suggestion);
}

/**
 * Given a parsed feed event and the set of UIDs already in the repo, return
 * the surviving event(s) that still need to be suggested.
 *
 * - One-off (no series): pass through unchanged. The caller already verified
 *   the top-level uid isn't in repo via `isAlreadyInRepo`.
 * - Recurrence cluster: try to revalidate with the trimmed occurrence set. If
 *   the trimmed cluster still satisfies clustering rules, return one trimmed
 *   ParsedVEvent. Otherwise dissolve into one-offs for the surviving
 *   occurrences (so they can still be suggested individually).
 *
 * This is the dedupe-side complement of implicit-series detection: the
 * detection step at parse time clusters feed occurrences; this step takes
 * those clusters and removes anything the admin already imported.
 */
function trimSeriesAgainstRepo(
  e: ParsedVEvent,
  repoUids: Set<string>,
  siteTz: string,
): ParsedVEvent[] {
  if (!e.series || e.series.kind !== 'recurrence') return [e];
  // Trim only applies to clusters that carry per-occurrence override UIDs
  // (which detectImplicitSeries emits for every occurrence, see Task 6).
  // Pure RRULE series with no overrides have nothing to dedupe against, so
  // we pass them through unchanged — the top-level uid match in
  // `isAlreadyInRepo` (or its caller-side bypass) is the right tool there.
  if (!e.series.overrides || e.series.overrides.length === 0) return [e];
  const trimmed = revalidateClusterAfterTrim(e, repoUids, siteTz);
  if (trimmed) return [trimmed];
  // Cluster dissolves into one-offs for surviving real occurrences.
  // Cancelled-skip rows (synthetic placeholders for missed weeks) are not
  // source VEVENTs and must not surface as importable suggestions.
  const overrides = e.series.overrides;
  return overrides
    .filter(o => !o.cancelled && (!o.uid || !repoUids.has(o.uid)))
    .map(o => ({
      uid: o.uid ?? `${e.uid}-${o.date}`,
      summary: e.summary,
      start: o.start_time
        ? `${o.date}T${o.start_time}:00`
        : `${o.date}T${e.start.length > 10 ? e.start.slice(11) : '00:00:00'}`,
      location: o.location ?? e.location,
      description: o.note ?? e.description,
      url: o.event_url ?? e.url,
      registration_url: o.registration_url ?? e.registration_url,
    }));
}

/**
 * The date past which a dismissal of this event can be safely ignored.
 *   - one-off: the event's calendar date (after that, the event is past)
 *   - recurrence series with season_end: that end date
 *   - schedule series: the last scheduled date
 *   - unbounded series (no season_end, no schedule): NEVER_EXPIRES sentinel
 */
function validUntilForEvent(e: ParsedVEvent): string {
  if (!e.series) return e.start.slice(0, 10);
  if (e.series.kind === 'recurrence') return e.series.season_end ?? NEVER_EXPIRES;
  const sched = e.series.schedule ?? [];
  if (sched.length === 0) return NEVER_EXPIRES;
  let last = sched[0].date;
  for (const s of sched) if (s.date > last) last = s.date;
  return last;
}

const WEEKDAY_INDEX: Record<RecurrenceDay, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
  thursday: 4, friday: 5, saturday: 6,
};

/**
 * Return a string that sorts an event by its next upcoming instance:
 *   - one-offs sort by their `start`
 *   - recurrence series sort by the next instance of `recurrence_day` on or
 *     after `nowLocalDate` (clamped to season_start when the series is still
 *     in the future)
 *   - schedule series sort by the first scheduled date >= nowLocalDate
 */
function nextOccurrenceSortKey(e: ParsedVEvent, nowLocalDate: string): string {
  if (!e.series) return e.start;
  if (e.series.kind === 'recurrence') {
    const startTime = e.start.length > 10 ? e.start.slice(11) : '';
    const seasonStart = e.series.season_start ?? e.start.slice(0, 10);
    const day = e.series.recurrence_day;
    const fromDate = seasonStart > nowLocalDate ? seasonStart : nowLocalDate;
    const nextDate = day ? nextWeekdayOnOrAfter(fromDate, day) : fromDate;
    return startTime ? `${nextDate}T${startTime}` : nextDate;
  }
  const sched = e.series.schedule ?? [];
  for (const s of sched) {
    if (s.date >= nowLocalDate) {
      return s.start_time ? `${s.date}T${s.start_time}` : s.date;
    }
  }
  return e.start;
}

function nextWeekdayOnOrAfter(date: string, day: RecurrenceDay): string {
  const targetIdx = WEEKDAY_INDEX[day];
  if (targetIdx === undefined) return date;
  const pd = Temporal.PlainDate.from(date);
  // Temporal: dayOfWeek is 1=Monday..7=Sunday. WEEKDAY_INDEX uses 0=Sunday..6=Saturday.
  const currentIdx = pd.dayOfWeek === 7 ? 0 : pd.dayOfWeek;
  return pd.add({ days: (targetIdx - currentIdx + 7) % 7 }).toString();
}

export function formatSeriesLabel(s: ParsedSeries): string {
  if (s.kind === 'recurrence' && s.recurrence && s.recurrence_day) {
    const day = s.recurrence_day[0].toUpperCase() + s.recurrence_day.slice(1);
    return s.recurrence === 'biweekly' ? `Every other ${day}` : `Every ${day}`;
  }
  if (s.kind === 'schedule' && s.schedule) return `${s.schedule.length} dates`;
  return 'Series';
}

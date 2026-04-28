import ICAL from 'ical.js';
import { Temporal } from '@js-temporal/polyfill';
import { NodeHtmlMarkdown } from 'node-html-markdown';
import type { ParsedVEvent, RecurrenceDay } from './types';

const htmlConverter = new NodeHtmlMarkdown();

const EXACT_PLACEHOLDERS = new Set<string>([
  'legacy event imported from webscorer',
  'tbd',
]);

const PLACEHOLDER_PATTERNS: RegExp[] = [
  /^more information.*will be posted closer to the start of the season/i,
  /^full information to be posted closer to the date/i,
];

const EMOJI_ONLY = /^[\p{Emoji}\p{Emoji_Modifier}\p{Emoji_Component}\s]*$/u;

/**
 * Convert an ICS DESCRIPTION (typically HTML from rich-text editors) to
 * markdown, then filter out known placeholders that mean "no real description
 * yet" (legacy imports, TBD, "to be posted closer" boilerplate, empty/emoji).
 *
 * Returns null when the description is absent or matches any placeholder; the
 * markdown string otherwise. Tests in tests/detect-implicit-series.test.ts.
 */
export function extractDescription(html: string | undefined): string | null {
  if (!html) return null;
  const md = htmlConverter.translate(html).trim();
  if (md === '') return null;
  if (EMOJI_ONLY.test(md)) return null;
  const lower = md.toLowerCase().trim();
  if (EXACT_PLACEHOLDERS.has(lower)) return null;
  for (const pattern of PLACEHOLDER_PATTERNS) {
    if (pattern.test(md)) return null;
  }
  return md;
}

const CANCELLED_RE = /\b(?:CANCELLED|CANCELED)\b/i;
const NO_RIDE_RE = /\bNO RIDE\b/i;
const WX_RESCHEDULED_RE = /\bWX RESCHEDULED\b/i;
const TRAILING_REASON_RE = /[-—]\s*([A-Za-z][A-Za-z0-9 ]{0,30})\s*$/;
const NO_DAY_RIDE_DESC_RE = /^\s*<?p?>?\s*No\s+(?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day\s+ride\b/i;
const NO_DAY_RIDE_REASON_RE = /No\s+\w+day\s+ride\s+(?:due to|because of)\s+(.+?)(?:[<.]|$)/i;

export interface CancellationSignal {
  cancelled: true;
  reason?: string;
}

/**
 * Detect a cancellation signal in an ICS occurrence's SUMMARY (preferred) or
 * DESCRIPTION (fallback). Returns null when no signal matches.
 *
 * Conditional cancellations in DESCRIPTION ("if there is no ride leader the
 * ride will be cancelled") are deliberately NOT matched — those rides are
 * still scheduled. The detector requires unconditional phrasing.
 */
export function detectCancellation(
  summary: string,
  description: string | undefined,
): CancellationSignal | null {
  const reasonFromSummary = (re: RegExp): string | undefined => {
    const match = summary.match(re);
    if (!match) return undefined;
    const after = summary.slice(match.index! + match[0].length);
    const reasonMatch = after.match(TRAILING_REASON_RE);
    return reasonMatch?.[1]?.trim();
  };

  if (WX_RESCHEDULED_RE.test(summary)) {
    return { cancelled: true, reason: 'WX' };
  }
  if (NO_RIDE_RE.test(summary)) {
    return { cancelled: true, reason: reasonFromSummary(NO_RIDE_RE) };
  }
  if (CANCELLED_RE.test(summary)) {
    return { cancelled: true, reason: reasonFromSummary(CANCELLED_RE) };
  }

  if (description) {
    if (NO_DAY_RIDE_DESC_RE.test(description)) {
      const reasonMatch = description.match(NO_DAY_RIDE_REASON_RE);
      return { cancelled: true, reason: reasonMatch?.[1]?.trim() };
    }
  }

  return null;
}

const MODAL_PROMOTION_THRESHOLD = 0.6;

/**
 * From a list of per-occurrence descriptions (already filtered through
 * extractDescription, so nulls represent placeholders or absences), pick the
 * modal description if it appears in ≥60% of the *non-null* entries.
 *
 * Nulls don't compete; the denominator is non-null entries only. This means
 * a cluster of 10 occurrences where 7 share description X and 3 are
 * placeholders becomes "master body = X", not "70% of 10 → no modal".
 */
export function pickModalDescription(descriptions: Array<string | null>): string | null {
  const present = descriptions.filter((d): d is string => d !== null);
  if (present.length === 0) return null;
  const counts = new Map<string, number>();
  for (const d of present) counts.set(d, (counts.get(d) ?? 0) + 1);
  let bestKey: string | null = null;
  let bestCount = 0;
  for (const [key, count] of counts) {
    if (count > bestCount) { bestCount = count; bestKey = key; }
  }
  if (bestKey === null) return null;
  return bestCount / present.length >= MODAL_PROMOTION_THRESHOLD ? bestKey : null;
}

const MIN_CLUSTER_SIZE = 4;
const MODAL_DOW_THRESHOLD = 0.8;
const ON_CYCLE_THRESHOLD = 0.6;
// 42 days = 6 weeks. Splits at gaps that signal an off-season break while
// preserving runs with up to two consecutive missed biweekly cycles
// (max plausible "missed" gap before the absence reads as off-season).
// Original 60d was too lenient: it merged biweekly winter + weekly spring
// in calendars that have a short off-season (e.g. #ottbikesocial 2026:
// 2/19 → 4/16 = 56d gap), classifying the whole thing as weekly with
// phantom cancelled-skip rows for both off-weeks and off-season weeks.
const MAX_GAP_DAYS = 42;
const WEEKLY_DAYS = 7;
const BIWEEKLY_DAYS = 14;

const DOW_INDEX_TO_NAME: RecurrenceDay[] = [
  'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday',
];

const STATUS_STRIP_RE = /\s*-\s*(?:CANCELLED|CANCELED|NO RIDE|WX RESCHEDULED)(?:\s*-\s*[A-Z0-9]+)?\s*$/i;

interface BucketEntry {
  master: ICAL.Event;
  zdt: Temporal.ZonedDateTime;
}

/**
 * Detect implicit weekly/biweekly series in a list of non-RRULE ICAL.Event
 * masters. Clusters that satisfy the rules become synthetic ParsedVEvent
 * instances with kind: 'recurrence'; non-clustered masters are returned as
 * orphans for the caller to map via the existing one-off path.
 *
 * Spec: ~/code/bike-app/docs/plans/2026-04-28-implicit-series-detection-design.md
 */
export function detectImplicitSeries(
  masters: ICAL.Event[],
  siteTz: string,
): { clusters: ParsedVEvent[]; orphans: ICAL.Event[] } {
  // Bucket by SUMMARY (with status suffixes stripped so cancelled occurrences
  // group with their siblings).
  const buckets = new Map<string, BucketEntry[]>();
  for (const m of masters) {
    if (!m.startDate || !m.summary) continue;
    const key = m.summary.replace(STATUS_STRIP_RE, '').trim();
    const zdt = icalTimeToSiteZdt(m.startDate, siteTz);
    const list = buckets.get(key) ?? [];
    list.push({ master: m, zdt });
    buckets.set(key, list);
  }

  const clusters: ParsedVEvent[] = [];
  const orphans: ICAL.Event[] = [];

  for (const [, entries] of buckets) {
    entries.sort((a, b) => Temporal.ZonedDateTime.compare(a.zdt, b.zdt));
    const subBuckets = splitByYearAndGap(entries);
    for (const sub of subBuckets) {
      const cluster = tryFormCluster(sub);
      if (cluster) clusters.push(cluster);
      else for (const e of sub) orphans.push(e.master);
    }
  }

  return { clusters, orphans };
}

function splitByYearAndGap(entries: BucketEntry[]): BucketEntry[][] {
  if (entries.length === 0) return [];
  const out: BucketEntry[][] = [];
  let current: BucketEntry[] = [entries[0]];
  for (let i = 1; i < entries.length; i++) {
    const prev = entries[i - 1];
    const curr = entries[i];
    const yearChanged = prev.zdt.year !== curr.zdt.year;
    const gapDays = Math.round(
      prev.zdt.until(curr.zdt, { largestUnit: 'days' }).total({ unit: 'days' }),
    );
    if (yearChanged || gapDays > MAX_GAP_DAYS) {
      out.push(current);
      current = [curr];
    } else {
      current.push(curr);
    }
  }
  out.push(current);
  return out;
}

function tryFormCluster(entries: BucketEntry[]): ParsedVEvent | null {
  if (entries.length < MIN_CLUSTER_SIZE) return null;

  // Modal DOW
  const dowCounts = new Map<number, number>();
  for (const e of entries) {
    const dow = e.zdt.dayOfWeek % 7;
    dowCounts.set(dow, (dowCounts.get(dow) ?? 0) + 1);
  }
  let modalDow = -1, modalDowCount = 0;
  for (const [d, n] of dowCounts) if (n > modalDowCount) { modalDow = d; modalDowCount = n; }
  if (modalDowCount / entries.length < MODAL_DOW_THRESHOLD) return null;

  const inCadence = entries.filter(e => (e.zdt.dayOfWeek % 7) === modalDow);

  // Modal cadence (gaps between in-cadence consecutive occurrences). The
  // modal gap must be weekly (7) or biweekly (14); other gaps may be any
  // positive multiple of the modal (handles missed weeks: a 14d gap in a
  // weekly cluster is two weeks with the middle one skipped). Truly
  // irregular spacing — modal not in {7, 14}, or any gap not a multiple
  // of the modal — rejects.
  if (inCadence.length < 2) return null;
  const gapCounts = new Map<number, number>();
  for (let i = 1; i < inCadence.length; i++) {
    const days = Math.round(
      inCadence[i - 1].zdt.until(inCadence[i].zdt, { largestUnit: 'days' }).total({ unit: 'days' }),
    );
    gapCounts.set(days, (gapCounts.get(days) ?? 0) + 1);
  }
  let modalGap = -1, modalGapCount = 0;
  for (const [g, n] of gapCounts) if (n > modalGapCount) { modalGap = g; modalGapCount = n; }
  if (modalGap !== WEEKLY_DAYS && modalGap !== BIWEEKLY_DAYS) return null;
  // Anchor the cycle at the first same-DOW occurrence and partition entries
  // into "on-cycle" (date = anchor + k * modalGap) and off-cycle extras.
  // Off-cycle extras ride along as override rows with their actual dates —
  // this is the "recurring + specific dates" pattern that fits real-world
  // data like a biweekly clinic with a make-up session inserted between
  // cycles (e.g. OBC's Group Riding Clinic: 4/11, 4/25, 5/9 biweekly + 5/16
  // extra). The cluster forms when at least ON_CYCLE_THRESHOLD of same-DOW
  // entries align with the cycle.
  const cycleAnchor = inCadence[0].zdt;
  const onCycleCount = inCadence.filter(e => {
    const days = Math.round(
      cycleAnchor.until(e.zdt, { largestUnit: 'days' }).total({ unit: 'days' }),
    );
    return days >= 0 && days % modalGap === 0;
  }).length;
  if (onCycleCount / inCadence.length < ON_CYCLE_THRESHOLD) return null;

  // Modal time-of-day (HH:MM in siteTz)
  const todCounts = new Map<string, number>();
  for (const e of entries) {
    const tod = e.zdt.toPlainTime().toString({ smallestUnit: 'minute' });
    todCounts.set(tod, (todCounts.get(tod) ?? 0) + 1);
  }
  let modalTod = '', modalTodCount = 0;
  for (const [t, n] of todCounts) if (n > modalTodCount) { modalTod = t; modalTodCount = n; }

  // Modal LOCATION
  const locCounts = new Map<string, number>();
  for (const e of entries) {
    const loc = e.master.location || '';
    if (loc) locCounts.set(loc, (locCounts.get(loc) ?? 0) + 1);
  }
  let modalLocation: string | undefined;
  let modalLocationCount = 0;
  for (const [l, n] of locCounts) if (n > modalLocationCount) { modalLocation = l; modalLocationCount = n; }
  // Promote modal location to master only when the threshold is met (otherwise leave master empty).
  const masterLocation = (modalLocation && modalLocationCount / entries.length >= MODAL_PROMOTION_THRESHOLD)
    ? modalLocation : undefined;

  // Modal URL (event_url)
  const urlCounts = new Map<string, number>();
  for (const e of entries) {
    const url = stringPropOrUndefined(e.master.component, 'url');
    if (url) urlCounts.set(url, (urlCounts.get(url) ?? 0) + 1);
  }
  let modalUrl: string | undefined;
  let modalUrlCount = 0;
  for (const [u, n] of urlCounts) if (n > modalUrlCount) { modalUrlCount = n; modalUrl = u; }
  const masterUrl = (modalUrl && modalUrlCount / entries.length >= MODAL_PROMOTION_THRESHOLD) ? modalUrl : undefined;

  // Modal description (≥60% of non-null entries)
  const extracted = entries.map(e => extractDescription(e.master.description || undefined));
  const masterDescription = pickModalDescription(extracted) ?? undefined;

  // Per-occurrence registration_url: extracted from DESCRIPTION (e.g.
  // RidewithGPS event/route links that OBC embeds per-occurrence).
  const ridewithGpsUrls = entries.map(e => extractRidewithGpsUrl(e.master.description || undefined));
  const rwgCounts = new Map<string, number>();
  for (const url of ridewithGpsUrls) if (url) rwgCounts.set(url, (rwgCounts.get(url) ?? 0) + 1);
  let modalRwg: string | undefined;
  let modalRwgCount = 0;
  for (const [u, n] of rwgCounts) if (n > modalRwgCount) { modalRwgCount = n; modalRwg = u; }
  const masterRegistrationUrl = (modalRwg && modalRwgCount / entries.length >= MODAL_PROMOTION_THRESHOLD)
    ? modalRwg : undefined;

  // Build per-occurrence overrides — ALWAYS one row per occurrence with at
  // least date+uid, so partial-import dedupe (build.server.ts repoUids) can
  // find every source UID. Field-level emission is still selective: a field
  // only appears on the override when it diverges from the master, so
  // overrides stay compact when a cluster is "boring".
  type Override = NonNullable<NonNullable<ParsedVEvent['series']>['overrides']>[number];
  const overrideRows: Override[] = entries.map((e, i) => {
    const tod = e.zdt.toPlainTime().toString({ smallestUnit: 'minute' });
    const loc = e.master.location || '';
    const url = stringPropOrUndefined(e.master.component, 'url');
    const desc = extracted[i];
    const rwg = ridewithGpsUrls[i];
    const cancellation = detectCancellation(e.master.summary, e.master.description || undefined);
    const ovr: Override = {
      date: e.zdt.toPlainDate().toString(),
      uid: e.master.uid,
    };
    if (tod !== modalTod) ovr.start_time = tod;
    if (loc && loc !== masterLocation) ovr.location = loc;
    if (url && url !== masterUrl) ovr.event_url = url;
    if (rwg && rwg !== masterRegistrationUrl) ovr.registration_url = rwg;
    if (cancellation) {
      ovr.cancelled = true;
      const reasonLabel = cancellation.reason ? ` — ${cancellation.reason}` : '';
      ovr.note = desc
        ? `Cancelled${reasonLabel}.\n\n${desc}`
        : `Cancelled${reasonLabel}.`;
    } else if (desc && desc !== masterDescription) {
      ovr.note = desc;
    }
    return ovr;
  });

  const recurrence: 'weekly' | 'biweekly' = modalGap === WEEKLY_DAYS ? 'weekly' : 'biweekly';
  const recurrence_day: RecurrenceDay = DOW_INDEX_TO_NAME[modalDow];
  const first = entries[0];
  const last = entries[entries.length - 1];
  const seasonStart = first.zdt.toPlainDate().toString();
  const seasonEnd = last.zdt.toPlainDate().toString();

  // Add cancelled overrides for missed cadence dates within the season —
  // weeks where the cycle says an occurrence should exist but the feed has
  // none. We use the override mechanism rather than `series.skip_dates` so
  // the public schedule renders them with a cancellation badge instead of
  // silently dropping them.
  const presentDates = new Set(overrideRows.map(o => o.date));
  for (const cycleDate of cadenceDatesInSeason(seasonStart, seasonEnd, modalGap)) {
    if (!presentDates.has(cycleDate)) {
      overrideRows.push({ date: cycleDate, cancelled: true });
    }
  }

  // Sort chronologically — cancelled-skip rows landed at the end above.
  overrideRows.sort((a, b) => a.date.localeCompare(b.date));

  return {
    uid: first.master.uid,
    summary: first.master.summary.replace(STATUS_STRIP_RE, '').trim(),
    start: `${seasonStart}T${modalTod}:00`,
    location: masterLocation,
    description: masterDescription,
    url: masterUrl,
    registration_url: masterRegistrationUrl,
    series: {
      kind: 'recurrence',
      recurrence,
      recurrence_day,
      season_start: seasonStart,
      season_end: seasonEnd,
      overrides: overrideRows,
    },
  };
}

function stringPropOrUndefined(comp: ICAL.Component, name: string): string | undefined {
  const v = comp.getFirstPropertyValue(name);
  if (v == null) return undefined;
  return String(v);
}

const RIDEWITHGPS_RE = /https?:\/\/(?:www\.)?ridewithgps\.com\/(?:routes|events)\/\d+/i;

/**
 * Extract a RidewithGPS event/route URL from a per-occurrence DESCRIPTION.
 * OBC and similar feeds embed the per-week registration link in description
 * HTML; this becomes the override's registration_url when it diverges from
 * the master. Returns the first match (descriptions rarely carry more
 * than one).
 */
function extractRidewithGpsUrl(description: string | undefined): string | undefined {
  if (!description) return undefined;
  const match = description.match(RIDEWITHGPS_RE);
  return match ? match[0] : undefined;
}

/**
 * Yield each cadence date within `[seasonStart, seasonEnd]` rolled forward
 * from `seasonStart` in `gapDays` steps. Lexicographic comparison on
 * YYYY-MM-DD strings matches chronological order. UTC iteration is safe for
 * 7- and 14-day gaps because integer-day arithmetic on UTC midnights stays
 * on the same calendar date in any siteTz.
 */
function cadenceDatesInSeason(seasonStart: string, seasonEnd: string, gapDays: number): string[] {
  const out: string[] = [];
  let cur = seasonStart;
  while (cur <= seasonEnd) {
    out.push(cur);
    const t = new Date(cur + 'T00:00:00Z').getTime() + gapDays * 24 * 3600 * 1000;
    cur = new Date(t).toISOString().slice(0, 10);
  }
  return out;
}

/**
 * Re-evaluate an existing cluster after some occurrences have been removed
 * (because they're already imported). Returns a new cluster ParsedVEvent if
 * the trimmed set still satisfies all six rules; otherwise returns null and
 * the caller should emit each remaining occurrence as a one-off.
 *
 * The trimmed set is described by occurrence dates + per-occurrence override
 * fields; the original ICAL.Event masters aren't passed back through. This
 * helper rebuilds a synthetic cluster directly from the override + master
 * fields the original detection produced, so we don't need to re-parse.
 */
export function revalidateClusterAfterTrim(
  cluster: ParsedVEvent,
  removedUids: Set<string>,
  _siteTz: string,
): ParsedVEvent | null {
  if (!cluster.series || cluster.series.kind !== 'recurrence') return cluster;
  const overrides = cluster.series.overrides ?? [];
  const surviving = overrides.filter(o => !o.uid || !removedUids.has(o.uid));
  // Real surviving occurrences only — synthetic cancelled-skip rows added by
  // the missed-week pass aren't real source VEVENTs and must not inflate the
  // size threshold or pretend to be importable one-offs.
  const realSurviving = surviving.filter(o => !o.cancelled);
  // The cluster's master also represents one occurrence (its UID is on the
  // top-level event). If that UID was removed, we lose the master too.
  const masterRemoved = cluster.uid ? removedUids.has(cluster.uid) : false;
  // Detect whether the master is also represented in overrides[] (the original
  // detection emits one override per occurrence, including the master). When
  // it is, don't double-count the master row toward `totalSurviving` — the
  // override entry already accounts for it.
  const masterInOverrides = cluster.uid
    ? overrides.some(o => o.uid === cluster.uid)
    : false;
  const masterContribution = masterInOverrides ? 0 : (masterRemoved ? 0 : 1);
  const totalSurviving = masterContribution + realSurviving.length;
  if (totalSurviving < MIN_CLUSTER_SIZE) return null;

  // Build a chronologically sorted list of dates from surviving overrides
  // plus (if not removed AND not already in overrides) the master's date.
  // Cancelled-skip rows are part of the cycle and stay in `slim` so the
  // gap-rule re-check sees a continuous schedule.
  type Slim = { date: string; start_time?: string };
  const slim: Slim[] = surviving.map(o => ({ date: o.date, start_time: o.start_time }));
  if (!masterInOverrides && !masterRemoved) {
    const masterDate = cluster.start.slice(0, 10);
    const masterTod = cluster.start.length > 10 ? cluster.start.slice(11, 16) : undefined;
    slim.push({ date: masterDate, start_time: masterTod });
  }
  slim.sort((a, b) => a.date.localeCompare(b.date));

  // Re-check gap rule (≤60d) and cadence (modal gap = 7 or 14 across surviving
  // occurrences in the modal DOW). For revalidation we don't re-parse DOW —
  // we trust that all occurrences in the existing cluster were on the modal
  // DOW or already flagged as overrides; we just check the gap distribution.
  for (let i = 1; i < slim.length; i++) {
    const prev = new Date(slim[i - 1].date + 'T00:00:00Z').getTime();
    const curr = new Date(slim[i].date + 'T00:00:00Z').getTime();
    const days = Math.round((curr - prev) / (24 * 3600 * 1000));
    if (days > MAX_GAP_DAYS) return null;
  }

  // Recompute cadence from the surviving inter-occurrence gaps.
  const gapCounts = new Map<number, number>();
  for (let i = 1; i < slim.length; i++) {
    const prev = new Date(slim[i - 1].date + 'T00:00:00Z').getTime();
    const curr = new Date(slim[i].date + 'T00:00:00Z').getTime();
    const days = Math.round((curr - prev) / (24 * 3600 * 1000));
    gapCounts.set(days, (gapCounts.get(days) ?? 0) + 1);
  }
  let modalGap = -1, modalGapCount = 0;
  for (const [g, n] of gapCounts) if (n > modalGapCount) { modalGap = g; modalGapCount = n; }
  if (modalGap !== WEEKLY_DAYS && modalGap !== BIWEEKLY_DAYS) return null;
  // Anchor the cycle at the first surviving date and check on-cycle ratio
  // against `slim` (date strings). Mirrors tryFormCluster's recurring-plus-
  // specific-dates rule so off-cycle survivors don't get rejected on trim.
  const slimAnchorMs = new Date(slim[0].date + 'T00:00:00Z').getTime();
  const onCycleCount = slim.filter(s => {
    const ms = new Date(s.date + 'T00:00:00Z').getTime();
    const days = Math.round((ms - slimAnchorMs) / (24 * 3600 * 1000));
    return days >= 0 && days % modalGap === 0;
  }).length;
  if (onCycleCount / slim.length < ON_CYCLE_THRESHOLD) return null;

  // Rebuild the trimmed series with updated cadence + season range. When the
  // master is removed we still want the cluster's modal time-of-day on the
  // new top-level start — falling back to '00:00' would mis-render the
  // suggestion sort key and the prefilled new-event time. We also reassign
  // cluster.uid to the first surviving real occurrence's uid; keeping the
  // removed master's uid would cause an ics_uid collision when the trimmed
  // suggestion is later imported (the original repo event already claims it).
  const seasonStart = slim[0].date;
  const seasonEnd = slim[slim.length - 1].date;
  const originalTod = cluster.start.length > 10 ? cluster.start.slice(11, 16) : undefined;
  const newUid = masterRemoved
    ? (realSurviving.find(o => o.uid)?.uid ?? cluster.uid)
    : cluster.uid;
  return {
    ...cluster,
    uid: newUid,
    start: masterRemoved
      ? `${seasonStart}T${slim[0].start_time ?? originalTod ?? '00:00'}:00`
      : cluster.start,
    series: {
      ...cluster.series,
      recurrence: modalGap === WEEKLY_DAYS ? 'weekly' : 'biweekly',
      season_start: seasonStart,
      season_end: seasonEnd,
      overrides: surviving.length > 0 ? surviving : undefined,
    },
  };
}

export function icalTimeToSiteZdt(t: ICAL.Time, siteTz: string): Temporal.ZonedDateTime {
  if (t.isDate) {
    return Temporal.PlainDate.from({ year: t.year, month: t.month, day: t.day })
      .toZonedDateTime(siteTz);
  }
  const zone = t.zone;
  const isFloating =
    zone == null ||
    (zone === ICAL.Timezone.localTimezone) ||
    (typeof zone.tzid === 'string' && zone.tzid === 'floating');
  if (isFloating) {
    return Temporal.PlainDateTime.from({
      year: t.year, month: t.month, day: t.day,
      hour: t.hour, minute: t.minute, second: t.second,
    }).toZonedDateTime(siteTz);
  }
  return Temporal.Instant.fromEpochMilliseconds(t.toJSDate().getTime())
    .toZonedDateTimeISO(siteTz);
}

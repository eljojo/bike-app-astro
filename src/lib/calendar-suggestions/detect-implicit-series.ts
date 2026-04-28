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

const MODAL_DESCRIPTION_THRESHOLD = 0.6;

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
  return bestCount / present.length >= MODAL_DESCRIPTION_THRESHOLD ? bestKey : null;
}

const MIN_CLUSTER_SIZE = 4;
const MODAL_DOW_THRESHOLD = 0.8;
const MAX_GAP_DAYS = 60;
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
  for (const e of entries) dowCounts.set(e.zdt.dayOfWeek % 7, (dowCounts.get(e.zdt.dayOfWeek % 7) ?? 0) + 1);
  let modalDow = -1, modalDowCount = 0;
  for (const [d, n] of dowCounts) if (n > modalDowCount) { modalDow = d; modalDowCount = n; }
  if (modalDowCount / entries.length < MODAL_DOW_THRESHOLD) return null;

  const inCadence = entries.filter(e => (e.zdt.dayOfWeek % 7) === modalDow);
  const outOfCadence = entries.filter(e => (e.zdt.dayOfWeek % 7) !== modalDow);

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
  for (const g of gapCounts.keys()) {
    if (g <= 0 || g % modalGap !== 0) return null;
  }

  const recurrence: 'weekly' | 'biweekly' = modalGap === WEEKLY_DAYS ? 'weekly' : 'biweekly';
  const recurrence_day: RecurrenceDay = DOW_INDEX_TO_NAME[modalDow];
  const first = entries[0];
  const last = entries[entries.length - 1];

  // Master start/summary built later in emission task; for now produce a
  // skeleton ParsedVEvent so the test can assert structural fields. Per-field
  // overrides (location/start_time/note/event_url/etc.) are emitted in the
  // next task.
  const seasonStart = first.zdt.toPlainDate().toString();
  const seasonEnd = last.zdt.toPlainDate().toString();
  const masterStartTime = first.zdt.toPlainTime().toString({ smallestUnit: 'minute' });

  return {
    uid: first.master.uid,
    summary: first.master.summary.replace(STATUS_STRIP_RE, '').trim(),
    start: `${seasonStart}T${masterStartTime}:00`,
    series: {
      kind: 'recurrence',
      recurrence,
      recurrence_day,
      season_start: seasonStart,
      season_end: seasonEnd,
      overrides: outOfCadence.map(e => ({
        date: e.zdt.toPlainDate().toString(),
        uid: e.master.uid,
      })),
    },
  };
}

function icalTimeToSiteZdt(t: ICAL.Time, siteTz: string): Temporal.ZonedDateTime {
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

import ical from 'node-ical';
import type { VEvent } from 'node-ical';
import type { ParsedFeed, ParsedSeries, ParsedVEvent, RecurrenceDay } from '../calendar-suggestions/types';

const DAY_FROM_RRULE: Record<string, RecurrenceDay> = {
  MO: 'monday', TU: 'tuesday', WE: 'wednesday', TH: 'thursday',
  FR: 'friday', SA: 'saturday', SU: 'sunday',
};

// Minimal structural types for the parts of node-ical's outputs we actually read.
// node-ical wraps rrule.js but only loosely types the result, so we narrow here.
interface RRuleOptions {
  freq?: string;              // "WEEKLY" | "MONTHLY" | ...
  interval?: number;
  byweekday?: string[];       // ["MO"], ["MO","WE","FR"], etc.
  until?: Date | string | null;
  count?: number | null;
}
interface RRuleLike {
  options?: RRuleOptions;
  between?: (after: Date, before: Date, inclusive?: boolean) => Date[];
}
interface VEventExtensions {
  rrule?: RRuleLike;
  exdate?: Record<string, Date | string>;
  recurrences?: Record<string, VEvent & { status?: string }>;
  status?: string;
  // node-ical sets this to 'date' for VALUE=DATE (all-day) events and 'date-time' otherwise.
  datetype?: string;
}
function ext(v: VEvent): VEventExtensions {
  return v as unknown as VEventExtensions;
}

/**
 * Parse an ICS document and project every timed datetime into `siteTz`'s local
 * clock time, emitting naive `YYYY-MM-DDTHH:MM:SS` strings (no offset, no Z).
 *
 * The downstream pipeline stores naive site-local clock times in YAML
 * (`start_time: "18:15"`) — that's the storage spec, not an oversight. The
 * parser's job is to deliver data in the shape the storage expects. `siteTz`
 * is the destination we project *into*; it isn't a "fallback when the feed
 * is silent." Whether the source had `TZID=America/Toronto`, a bare `Z`
 * literal, or a TZID for a different city, we always project to the same
 * site-local clock — so an Ottawa instance importing a Vancouver feed sees
 * those events at the equivalent Toronto-clock time. This is consistent with
 * how the rest of the platform treats event times.
 */
export function parseIcs(text: string, sourceUrl: string, siteTz: string): ParsedFeed {
  const parsed = ical.parseICS(text);
  const events: ParsedVEvent[] = [];
  for (const key of Object.keys(parsed)) {
    const v = parsed[key];
    if (!v || v.type !== 'VEVENT') continue;
    const ve = v as VEvent;
    const event = ext(ve).rrule ? mapSeries(ve, siteTz) : mapOneOff(ve, siteTz);
    if (event) events.push(event);
  }
  return {
    fetched_at: new Date().toISOString(),
    source_url: sourceUrl,
    events,
  };
}

function mapOneOff(v: VEvent, siteTz: string): ParsedVEvent | null {
  if (!v.uid || !v.summary || !v.start) return null;
  const isAllDay = ext(v).datetype === 'date';
  return {
    uid: String(v.uid),
    summary: String(v.summary),
    start: renderDateTime(v.start, isAllDay, siteTz),
    end: v.end ? renderDateTime(v.end, isAllDay, siteTz) : undefined,
    location: v.location ? String(v.location) : undefined,
    description: v.description ? String(v.description) : undefined,
    url: v.url ? String(v.url) : undefined,
  };
}

function mapSeries(v: VEvent, siteTz: string): ParsedVEvent | null {
  const xv = ext(v);
  if (!v.uid || !v.summary || !v.start || !xv.rrule) return null;
  const opts = xv.rrule.options ?? {};
  const freq = opts.freq ?? '';
  const interval = opts.interval ?? 1;
  const byweekday = opts.byweekday ?? [];

  const base = mapOneOff(v, siteTz);
  if (!base) return null;

  const isCleanWeekly =
    freq === 'WEEKLY' &&
    (interval === 1 || interval === 2) &&
    byweekday.length === 1;

  if (!isCleanWeekly) return { ...base, series: buildScheduleFallback(v, siteTz) };

  const recurrence_day = DAY_FROM_RRULE[byweekday[0]];
  const recurrence = interval === 2 ? 'biweekly' : 'weekly';

  const season_start = formatDateOnly(v.start as Date, siteTz);
  const season_end = computeSeasonEnd(opts, v.start as Date, interval, siteTz);

  // Deduplicate exdate values: the object has both date-only and full ISO keys pointing to
  // the same Date objects, so we collect unique ISO strings first.
  const exdateValues = Object.values(xv.exdate ?? {});
  const seenIso = new Set<string>();
  const exdates: string[] = [];
  for (const raw of exdateValues) {
    const d = raw instanceof Date ? raw : new Date(raw);
    const iso = d.toISOString();
    if (!seenIso.has(iso)) {
      seenIso.add(iso);
      exdates.push(formatDateOnly(d, siteTz));
    }
  }
  exdates.sort();

  // RECURRENCE-ID overrides. node-ical keys this object by both the date-only form
  // and the full ISO form pointing at the same override object — dedupe by the
  // override's resolved instant so we emit each rescheduled occurrence once.
  const overrides: NonNullable<ParsedSeries['overrides']> = [];
  const seenOverrideIso = new Set<string>();
  for (const recur of Object.values(xv.recurrences ?? {})) {
    if (!recur.start) continue;
    const start = recur.start as Date;
    const iso = start.toISOString();
    if (seenOverrideIso.has(iso)) continue;
    seenOverrideIso.add(iso);
    overrides.push({
      date: formatDateOnly(start, siteTz),
      start_time: formatTime(start, siteTz),
      location: recur.location ? String(recur.location) : undefined,
      cancelled: String(recur.status ?? '').toUpperCase() === 'CANCELLED',
    });
  }

  return {
    ...base,
    series: {
      kind: 'recurrence',
      recurrence,
      recurrence_day,
      season_start,
      season_end,
      skip_dates: exdates.length ? exdates : undefined,
      overrides: overrides.length ? overrides : undefined,
    },
  };
}

function computeSeasonEnd(opts: RRuleOptions, dtstart: Date, interval: number, siteTz: string): string {
  if (opts.until) {
    // UNTIL in RFC 5545 is a UTC instant. Project into siteTz so the user-facing
    // season_end is the local calendar date of the last allowed occurrence, not
    // the UTC date (which can drift by one near midnight).
    const u = opts.until instanceof Date ? opts.until : new Date(opts.until);
    return formatDateOnly(u, siteTz);
  }
  if (opts.count) {
    const last = new Date(dtstart.getTime());
    last.setUTCDate(last.getUTCDate() + (opts.count - 1) * interval * 7);
    return formatDateOnly(last, siteTz);
  }
  // Unbounded — cap at DTSTART + 1 year.
  const cap = new Date(dtstart.getTime());
  cap.setUTCFullYear(cap.getUTCFullYear() + 1);
  return formatDateOnly(cap, siteTz);
}

const SCHEDULE_HORIZON_DAYS = 365;

function buildScheduleFallback(v: VEvent, siteTz: string): ParsedSeries {
  const rule = ext(v).rrule;
  if (!rule || !v.start) return { kind: 'schedule', schedule: [] };
  const from = v.start as Date;
  const to = new Date(from.getTime() + SCHEDULE_HORIZON_DAYS * 24 * 3600 * 1000);
  // rrule.js between(after, before, inclusive)
  const occurrences = typeof rule.between === 'function'
    ? rule.between(from, to, true)
    : [];
  const schedule = occurrences.map(d => ({
    date: formatDateOnly(d, siteTz),
    start_time: formatTime(d, siteTz),
    location: v.location ? String(v.location) : undefined,
  }));
  return { kind: 'schedule', schedule };
}

/**
 * Render a VEvent start/end as a string downstream code slices into naive
 * `YYYY-MM-DD` and `HH:MM` parts.
 *
 * - All-day events → `YYYY-MM-DD` via local-time getters. node-ical constructs
 *   VALUE=DATE Dates as `new Date(year, monthIndex, day)` (server-local-midnight),
 *   so local getters round-trip the authored calendar date. Workers runs in UTC,
 *   so this matches the source date directly.
 * - Timed events → `YYYY-MM-DDTHH:MM:SS` projected into siteTz, no offset, no Z.
 *   The downstream YAML stores naive site-local clock times; we hand it that
 *   shape directly.
 */
function renderDateTime(d: Date | string, isAllDay: boolean, siteTz: string): string {
  if (!(d instanceof Date)) d = new Date(d);
  if (isAllDay) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  }
  const p = getLocalParts(d, siteTz);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
}

function formatDateOnly(d: Date, siteTz: string): string {
  const p = getLocalParts(d, siteTz);
  return `${p.year}-${p.month}-${p.day}`;
}

function formatTime(d: Date, siteTz: string): string {
  const p = getLocalParts(d, siteTz);
  return `${p.hour}:${p.minute}`;
}

interface LocalParts {
  year: string; month: string; day: string;
  hour: string; minute: string; second: string;
}

/**
 * Extract clock parts in the given IANA TZ via Intl.DateTimeFormat (Workers-compatible).
 * Single source of truth for "what does this UTC instant look like on a wall clock in tz?".
 */
function getLocalParts(d: Date, tz: string): LocalParts {
  const formatted = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(d).reduce<Record<string, string>>((acc, p) => {
    if (p.type !== 'literal') acc[p.type] = p.value;
    return acc;
  }, {});
  return {
    year: formatted.year, month: formatted.month, day: formatted.day,
    // Intl can render 24h hour as '24' for midnight in some locales; normalize.
    hour: formatted.hour === '24' ? '00' : formatted.hour,
    minute: formatted.minute, second: formatted.second,
  };
}

const FETCH_TIMEOUT_MS = 5_000;

export async function fetchIcsFeed(url: string, siteTz: string): Promise<ParsedFeed> {
  const resp = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!resp.ok) throw new Error(`ICS fetch failed: ${resp.status} ${resp.statusText} (${url})`);
  const text = await resp.text();
  return parseIcs(text, url, siteTz);
}

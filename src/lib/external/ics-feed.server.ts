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
}
function ext(v: VEvent): VEventExtensions {
  return v as unknown as VEventExtensions;
}

export function parseIcs(text: string, sourceUrl: string): ParsedFeed {
  const parsed = ical.parseICS(text);
  const events: ParsedVEvent[] = [];
  for (const key of Object.keys(parsed)) {
    const v = parsed[key];
    if (!v || v.type !== 'VEVENT') continue;
    const ve = v as VEvent;
    const event = ext(ve).rrule ? mapSeries(ve) : mapOneOff(ve);
    if (event) events.push(event);
  }
  return {
    fetched_at: new Date().toISOString(),
    source_url: sourceUrl,
    events,
  };
}

function mapSeries(v: VEvent): ParsedVEvent | null {
  const xv = ext(v);
  if (!v.uid || !v.summary || !v.start || !xv.rrule) return null;
  const opts = xv.rrule.options ?? {};
  const freq = opts.freq ?? '';
  const interval = opts.interval ?? 1;
  const byweekday = opts.byweekday ?? [];

  const base = mapOneOff(v);
  if (!base) return null;

  const isCleanWeekly =
    freq === 'WEEKLY' &&
    (interval === 1 || interval === 2) &&
    byweekday.length === 1;

  if (!isCleanWeekly) return { ...base, series: buildScheduleFallback(v) };

  const recurrence_day = DAY_FROM_RRULE[byweekday[0]];
  const recurrence = interval === 2 ? 'biweekly' : 'weekly';

  const season_start = formatDateOnly(v.start as Date);
  const season_end = computeSeasonEnd(opts, v.start as Date, interval);

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
      exdates.push(formatDateOnly(d));
    }
  }
  exdates.sort();

  // RECURRENCE-ID overrides
  const overrides: NonNullable<ParsedSeries['overrides']> = [];
  for (const recur of Object.values(xv.recurrences ?? {})) {
    if (!recur.start) continue;
    overrides.push({
      date: formatDateOnly(recur.start as Date),
      start_time: formatTime(recur.start as Date),
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

function computeSeasonEnd(opts: RRuleOptions, dtstart: Date, interval: number): string {
  if (opts.until) {
    return formatDateOnly(opts.until instanceof Date ? opts.until : new Date(opts.until));
  }
  if (opts.count) {
    const last = new Date(dtstart.getTime());
    last.setUTCDate(last.getUTCDate() + (opts.count - 1) * interval * 7);
    return formatDateOnly(last);
  }
  // Unbounded — cap at DTSTART + 1 year.
  const cap = new Date(dtstart.getTime());
  cap.setUTCFullYear(cap.getUTCFullYear() + 1);
  return formatDateOnly(cap);
}

function formatDateOnly(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function formatTime(d: Date): string {
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

const SCHEDULE_HORIZON_DAYS = 365;

function buildScheduleFallback(v: VEvent): ParsedSeries {
  const rule = ext(v).rrule;
  if (!rule || !v.start) return { kind: 'schedule', schedule: [] };
  const from = v.start as Date;
  const to = new Date(from.getTime() + SCHEDULE_HORIZON_DAYS * 24 * 3600 * 1000);
  // rrule.js between(after, before, inclusive)
  const occurrences = typeof rule.between === 'function'
    ? rule.between(from, to, true)
    : [];
  const schedule = occurrences.map(d => ({
    date: formatDateOnly(d),
    start_time: formatTime(d),
    location: v.location ? String(v.location) : undefined,
  }));
  return { kind: 'schedule', schedule };
}

function mapOneOff(v: VEvent): ParsedVEvent | null {
  if (!v.uid || !v.summary || !v.start) return null;
  return {
    uid: String(v.uid),
    summary: String(v.summary),
    start: toIso(v.start),
    end: v.end ? toIso(v.end) : undefined,
    location: v.location ? String(v.location) : undefined,
    description: v.description ? String(v.description) : undefined,
    url: v.url ? String(v.url) : undefined,
  };
}

function toIso(d: Date | string): string {
  return d instanceof Date ? d.toISOString() : new Date(d).toISOString();
}

const FETCH_TIMEOUT_MS = 5_000;

export async function fetchIcsFeed(url: string): Promise<ParsedFeed> {
  const resp = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!resp.ok) throw new Error(`ICS fetch failed: ${resp.status} ${resp.statusText} (${url})`);
  const text = await resp.text();
  return parseIcs(text, url);
}

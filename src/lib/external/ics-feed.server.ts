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
 * Parse an ICS document.
 *
 * `fallbackTz` is the IANA TZ to render timed events in when the source VEVENT
 * has no TZID (bare `DTSTART:…Z` literals or floating times). Without a fallback
 * those events serialize as UTC ISO strings, which the admin sees as a 4-5h
 * skew when the calendar is for a city outside UTC. Pass `cityConfig.timezone`
 * for the city-local feeds the admin-suggestions feature consumes.
 */
export function parseIcs(text: string, sourceUrl: string, fallbackTz?: string): ParsedFeed {
  const parsed = ical.parseICS(text);
  const events: ParsedVEvent[] = [];
  for (const key of Object.keys(parsed)) {
    const v = parsed[key];
    if (!v || v.type !== 'VEVENT') continue;
    const ve = v as VEvent;
    const event = ext(ve).rrule ? mapSeries(ve, fallbackTz) : mapOneOff(ve, fallbackTz);
    if (event) events.push(event);
  }
  return {
    fetched_at: new Date().toISOString(),
    source_url: sourceUrl,
    events,
  };
}

function mapSeries(v: VEvent, fallbackTz?: string): ParsedVEvent | null {
  const xv = ext(v);
  if (!v.uid || !v.summary || !v.start || !xv.rrule) return null;
  const opts = xv.rrule.options ?? {};
  const freq = opts.freq ?? '';
  const interval = opts.interval ?? 1;
  const byweekday = opts.byweekday ?? [];

  const base = mapOneOff(v, fallbackTz);
  if (!base) return null;

  const tz = getTz(v.start) ?? fallbackTz;

  const isCleanWeekly =
    freq === 'WEEKLY' &&
    (interval === 1 || interval === 2) &&
    byweekday.length === 1;

  if (!isCleanWeekly) return { ...base, series: buildScheduleFallback(v, tz) };

  const recurrence_day = DAY_FROM_RRULE[byweekday[0]];
  const recurrence = interval === 2 ? 'biweekly' : 'weekly';

  const season_start = formatDateOnly(v.start as Date, tz);
  const season_end = computeSeasonEnd(opts, v.start as Date, interval, tz);

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
      // EXDATE inherits DTSTART's TZID per RFC 5545, but if node-ical attached a
      // different `tz` to this Date (e.g. UTC for an EXDATE:Z literal with no TZID
      // even when DTSTART had one), prefer DTSTART's so the calendar date matches
      // what the recurrence rule produced.
      exdates.push(formatDateOnly(d, tz ?? getTz(d)));
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
    // The override's own TZID wins (a rescheduled occurrence may move zones);
    // fall back to DTSTART's tz so we don't accidentally render in UTC.
    const overrideTz = getTz(start) ?? tz;
    overrides.push({
      date: formatDateOnly(start, overrideTz),
      start_time: formatTime(start, overrideTz),
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

function computeSeasonEnd(opts: RRuleOptions, dtstart: Date, interval: number, tz?: string): string {
  if (opts.until) {
    // UNTIL in RFC 5545 is a UTC instant (must end with Z). Project it into DTSTART's
    // TZ so the user-facing season_end is the local calendar date of the last allowed
    // occurrence, not the UTC date (which can drift by one near midnight).
    const u = opts.until instanceof Date ? opts.until : new Date(opts.until);
    return formatDateOnly(u, tz);
  }
  if (opts.count) {
    const last = new Date(dtstart.getTime());
    last.setUTCDate(last.getUTCDate() + (opts.count - 1) * interval * 7);
    return formatDateOnly(last, tz);
  }
  // Unbounded — cap at DTSTART + 1 year.
  const cap = new Date(dtstart.getTime());
  cap.setUTCFullYear(cap.getUTCFullYear() + 1);
  return formatDateOnly(cap, tz);
}

/** Format `YYYY-MM-DD` for d in the given TZ if known, else UTC. */
function formatDateOnly(d: Date, tz?: string): string {
  if (tz) {
    const p = getLocalParts(d, tz);
    return `${p.year}-${p.month}-${p.day}`;
  }
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/** Format `HH:MM` for d in the given TZ if known, else UTC. */
function formatTime(d: Date, tz?: string): string {
  if (tz) {
    const p = getLocalParts(d, tz);
    return `${p.hour}:${p.minute}`;
  }
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

const SCHEDULE_HORIZON_DAYS = 365;

function buildScheduleFallback(v: VEvent, tz?: string): ParsedSeries {
  const rule = ext(v).rrule;
  if (!rule || !v.start) return { kind: 'schedule', schedule: [] };
  const from = v.start as Date;
  const to = new Date(from.getTime() + SCHEDULE_HORIZON_DAYS * 24 * 3600 * 1000);
  // rrule.js between(after, before, inclusive)
  const occurrences = typeof rule.between === 'function'
    ? rule.between(from, to, true)
    : [];
  const schedule = occurrences.map(d => ({
    date: formatDateOnly(d, tz),
    start_time: formatTime(d, tz),
    location: v.location ? String(v.location) : undefined,
  }));
  return { kind: 'schedule', schedule };
}

function mapOneOff(v: VEvent, fallbackTz?: string): ParsedVEvent | null {
  if (!v.uid || !v.summary || !v.start) return null;
  const isAllDay = ext(v).datetype === 'date';
  const tz = getTz(v.start) ?? fallbackTz;
  return {
    uid: String(v.uid),
    summary: String(v.summary),
    start: renderDateTime(v.start, isAllDay, tz),
    end: v.end ? renderDateTime(v.end, isAllDay, getTz(v.end) ?? tz) : undefined,
    location: v.location ? String(v.location) : undefined,
    description: v.description ? String(v.description) : undefined,
    url: v.url ? String(v.url) : undefined,
  };
}

/** node-ical attaches a `tz` IANA name to Date objects parsed from a TZID property. */
function getTz(d: Date | string | undefined): string | undefined {
  if (!(d instanceof Date)) return undefined;
  const tz = (d as Date & { tz?: string }).tz;
  if (!tz) return undefined;
  // 'Etc/Unknown' is node-ical's sentinel when VTIMEZONE can't be resolved.
  // 'UTC' / 'Etc/UTC' come from `Z`-literal DTSTART values — for these the source
  // had no human-meaningful zone, so preserve the existing `…Z` ISO form.
  if (tz === 'Etc/Unknown' || tz === 'UTC' || tz === 'Etc/UTC') return undefined;
  return tz;
}

/**
 * Render a VEvent start/end as a string downstream code can compare lexicographically.
 *
 * - All-day events → `YYYY-MM-DD` via local-time getters. node-ical constructs
 *   VALUE=DATE events as `new Date(year, monthIndex, day)` which is local-midnight,
 *   so UTC getters would shift the calendar day east of UTC (Tokyo: `2026-06-12` → `2026-06-11`).
 * - Timed events with a TZID → `YYYY-MM-DDTHH:MM:SS±HH:MM` in the original TZ. This makes
 *   `slice(0,10)` and `slice(11,16)` produce the local clock date/time the user authored
 *   (so prefill into a YAML frontmatter editor doesn't reinterpret UTC as local), while
 *   the offset preserves the unambiguous UTC instant for `new Date(...)` consumers.
 * - Timed events without a TZID (DTSTART:…Z literal, or floating time) → UTC ISO string
 *   as before — there's no source-of-truth zone to honour.
 */
function renderDateTime(d: Date | string, isAllDay: boolean, tz?: string): string {
  if (!(d instanceof Date)) d = new Date(d);
  if (isAllDay) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  }
  if (!tz) return d.toISOString();
  return formatLocalIsoWithOffset(d, tz);
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

/**
 * Project a UTC instant into `tz`'s local clock time, returning an ISO string with
 * explicit offset (e.g. `2026-04-29T18:15:00-04:00`). The offset is derived by
 * comparing local-clock-as-UTC against the original instant.
 */
function formatLocalIsoWithOffset(d: Date, tz: string): string {
  const p = getLocalParts(d, tz);
  const local = `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
  const offsetMin = Math.round((Date.UTC(
    Number(p.year), Number(p.month) - 1, Number(p.day),
    Number(p.hour), Number(p.minute), Number(p.second),
  ) - d.getTime()) / 60000);
  const sign = offsetMin >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMin);
  const offH = String(Math.floor(abs / 60)).padStart(2, '0');
  const offM = String(abs % 60).padStart(2, '0');
  return `${local}${sign}${offH}:${offM}`;
}

const FETCH_TIMEOUT_MS = 5_000;

export async function fetchIcsFeed(url: string, fallbackTz?: string): Promise<ParsedFeed> {
  const resp = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!resp.ok) throw new Error(`ICS fetch failed: ${resp.status} ${resp.statusText} (${url})`);
  const text = await resp.text();
  return parseIcs(text, url, fallbackTz);
}

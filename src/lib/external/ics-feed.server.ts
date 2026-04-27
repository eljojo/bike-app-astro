import ICAL from 'ical.js';
import type { ParsedFeed, ParsedSeries, ParsedVEvent, RecurrenceDay } from '../calendar-suggestions/types';

const DAY_FROM_RRULE: Record<string, RecurrenceDay> = {
  MO: 'monday', TU: 'tuesday', WE: 'wednesday', TH: 'thursday',
  FR: 'friday', SA: 'saturday', SU: 'sunday',
};

/**
 * Parse an ICS document and project every timed datetime into `siteTz`'s local
 * clock, emitting naive `YYYY-MM-DDTHH:MM:SS` strings (no offset, no Z).
 *
 * The downstream pipeline stores naive site-local clock times in YAML
 * (`start_time: "18:15"`) — that's the storage spec, not an oversight. The
 * parser's job is to deliver data in the shape the storage expects. `siteTz`
 * is the destination we project *into*; it isn't a "fallback when the feed
 * is silent." Whether the source has `TZID=America/Toronto`, a bare `Z`
 * literal, or a TZID for a different city, we always project to the same
 * site-local clock — so an Ottawa instance importing a Vancouver feed sees
 * those events at the equivalent Toronto-clock time.
 *
 * Implementation notes (vs. node-ical):
 * - VTIMEZONE blocks are registered with `ICAL.TimezoneService` so that
 *   TZID-bearing times resolve to correct UTC instants via `time.toJSDate()`.
 * - RECURRENCE-ID overrides are NOT auto-bucketed; we group VEVENTs by UID
 *   ourselves and split master vs. exception via `event.isRecurrenceException()`.
 */
export function parseIcs(text: string, sourceUrl: string, siteTz: string, now?: Date): ParsedFeed {
  const jcal = ICAL.parse(text);
  const vcal = new ICAL.Component(jcal);

  // VTIMEZONE blocks are NOT registered globally. ical.js's Time parser walks
  // the component tree (Component#getTimeZoneByID) and resolves TZID-bearing
  // properties against the file's own VTIMEZONE definitions per parse. A
  // process-global TimezoneService.register would let one malformed feed
  // poison the TZID for every later feed in the same Workers isolate.

  // Group VEVENTs by UID. Masters carry the RRULE; RECURRENCE-ID exceptions
  // are collected separately and attached to the master in mapSeries.
  const masters = new Map<string, ICAL.Event>();
  const overridesByUid = new Map<string, ICAL.Event[]>();
  for (const ve of vcal.getAllSubcomponents('vevent')) {
    const ev = new ICAL.Event(ve);
    if (!ev.uid) continue;
    if (ev.isRecurrenceException()) {
      const list = overridesByUid.get(ev.uid) ?? [];
      list.push(ev);
      overridesByUid.set(ev.uid, list);
    } else {
      // If two VEVENTs share a UID without RECURRENCE-ID, last-write-wins
      // (matches node-ical's flat keying behavior on duplicate UIDs).
      masters.set(ev.uid, ev);
    }
  }

  const nowInstant = now ?? new Date();
  const events: ParsedVEvent[] = [];
  for (const [uid, master] of masters) {
    const eventOverrides = overridesByUid.get(uid) ?? [];
    const isRecurring = master.component.hasProperty('rrule');
    const out = isRecurring
      ? mapSeries(master, eventOverrides, siteTz, nowInstant)
      : mapOneOff(master, siteTz);
    if (out) events.push(out);
  }

  return {
    fetched_at: nowInstant.toISOString(),
    source_url: sourceUrl,
    events,
  };
}

function mapOneOff(ev: ICAL.Event, siteTz: string): ParsedVEvent | null {
  if (!ev.uid || !ev.summary || !ev.startDate) return null;
  const isAllDay = ev.startDate.isDate;
  const startUtc = timeToUtcInstant(ev.startDate, siteTz);
  const endUtc = ev.endDate ? timeToUtcInstant(ev.endDate, siteTz) : null;
  return {
    uid: ev.uid,
    summary: ev.summary,
    start: renderDateTime(startUtc, isAllDay, siteTz),
    end: endUtc ? renderDateTime(endUtc, isAllDay, siteTz) : undefined,
    location: ev.location || undefined,
    description: ev.description || undefined,
    url: stringPropOrUndefined(ev.component, 'url'),
  };
}

function mapSeries(
  master: ICAL.Event,
  overrides: ICAL.Event[],
  siteTz: string,
  now: Date,
): ParsedVEvent | null {
  if (!master.uid || !master.summary || !master.startDate) return null;
  const rrule = master.component.getFirstPropertyValue('rrule') as ICAL.Recur | null;
  if (!rrule) return null;

  const base = mapOneOff(master, siteTz);
  if (!base) return null;

  const freq = rrule.freq ?? '';
  const interval = rrule.interval ?? 1;
  const byday = rruleByDay(rrule);

  const isCleanWeekly =
    freq === 'WEEKLY' &&
    (interval === 1 || interval === 2) &&
    byday.length === 1;

  if (!isCleanWeekly) {
    return { ...base, series: buildScheduleFallback(master, overrides, siteTz, now) };
  }

  const recurrence_day = DAY_FROM_RRULE[byday[0]];
  const recurrence = interval === 2 ? 'biweekly' : 'weekly';

  const startUtc = timeToUtcInstant(master.startDate, siteTz);
  const season_start = formatDateOnly(startUtc, siteTz);
  const season_end = computeSeasonEnd(rrule, startUtc, interval, siteTz);

  // EXDATE values: ical.js exposes them as separate properties (one per
  // EXDATE line) and each property may carry multiple comma-separated values
  // — RFC 5545 allows `EXDATE:20260518T180000Z,20260601T180000Z` on a single
  // line, and Google Calendar emits this form. Iterate every value, not just
  // the first.
  const exdateValues: Date[] = [];
  for (const prop of master.component.getAllProperties('exdate')) {
    for (const val of prop.getValues()) {
      if (val && typeof (val as ICAL.Time).toJSDate === 'function') {
        exdateValues.push(timeToUtcInstant(val as ICAL.Time, siteTz));
      }
    }
  }
  const seenIso = new Set<string>();
  const exdates: string[] = [];
  for (const d of exdateValues) {
    const iso = d.toISOString();
    if (!seenIso.has(iso)) {
      seenIso.add(iso);
      exdates.push(formatDateOnly(d, siteTz));
    }
  }
  exdates.sort();

  // RECURRENCE-ID overrides — already grouped by UID in parseIcs.
  const overrideOut: NonNullable<ParsedSeries['overrides']> = [];
  const seenOverrideIso = new Set<string>();
  for (const ovr of overrides) {
    if (!ovr.startDate) continue;
    const start = timeToUtcInstant(ovr.startDate, siteTz);
    const iso = start.toISOString();
    if (seenOverrideIso.has(iso)) continue;
    seenOverrideIso.add(iso);
    const status = stringPropOrUndefined(ovr.component, 'status');
    overrideOut.push({
      date: formatDateOnly(start, siteTz),
      start_time: formatTime(start, siteTz),
      location: ovr.location || undefined,
      cancelled: (status ?? '').toUpperCase() === 'CANCELLED',
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
      overrides: overrideOut.length ? overrideOut : undefined,
    },
  };
}

function computeSeasonEnd(
  rrule: ICAL.Recur,
  dtstart: Date,
  interval: number,
  siteTz: string,
): string {
  if (rrule.until) {
    return formatDateOnly(timeToUtcInstant(rrule.until, siteTz), siteTz);
  }
  if (rrule.count) {
    const last = new Date(dtstart.getTime());
    last.setUTCDate(last.getUTCDate() + (rrule.count - 1) * interval * 7);
    return formatDateOnly(last, siteTz);
  }
  // Unbounded — cap at DTSTART + 1 year (matches the prior behavior).
  const cap = new Date(dtstart.getTime());
  cap.setUTCFullYear(cap.getUTCFullYear() + 1);
  return formatDateOnly(cap, siteTz);
}

const SCHEDULE_HORIZON_DAYS = 365;
const SCHEDULE_ITER_CAP = 10_000;

type ScheduleEntry = { date: string; start_time: string; location?: string };
type ScheduleOverride = { date: string; start_time?: string; location?: string; cancelled?: boolean };

function buildScheduleFallback(
  master: ICAL.Event,
  overrides: ICAL.Event[],
  siteTz: string,
  now: Date,
): ParsedSeries {
  if (!master.startDate) return { kind: 'schedule', schedule: [] };
  // Anchor the schedule to `now`, not master.startDate. A monthly series with
  // DTSTART years in the past would otherwise emit only stale dates and
  // disappear from suggestions (`some(s => s.date >= nowDate)` returns false).
  // Per ical.js semantics we keep iterating from the true DTSTART (overriding
  // the iterator's dtstart can change anchoring for rules like FREQ=MONTHLY
  // BYDAY=1SU); we just skip past entries earlier than `now` and stop after
  // `now + 365d`.
  const fromInstant = now;
  const toInstant = new Date(fromInstant.getTime() + SCHEDULE_HORIZON_DAYS * 24 * 3600 * 1000);

  // Index RECURRENCE-ID overrides by their original (ICAL) occurrence date in
  // siteTz YYYY-MM-DD. ical.js's master.iterator() honors EXDATE automatically
  // but does NOT apply RECURRENCE-ID; we reconcile manually so cancelled
  // occurrences disappear from the schedule and moved ones reflect the new
  // time/location.
  const overridesByOriginalDate = indexOverridesByOriginalDate(overrides, siteTz);

  const schedule: ScheduleEntry[] = [];

  const iter = master.iterator();
  let next: ICAL.Time | null;
  let safety = 0;
  while ((next = iter.next())) {
    safety += 1;
    if (safety > SCHEDULE_ITER_CAP) break;
    const inst = timeToUtcInstant(next, siteTz);
    if (inst.getTime() > toInstant.getTime()) break;
    if (inst.getTime() < fromInstant.getTime()) continue;
    const originalDate = formatDateOnly(inst, siteTz);
    const override = overridesByOriginalDate.get(originalDate);
    if (override?.cancelled) continue;
    if (override) {
      schedule.push({
        date: override.date,
        start_time: override.start_time ?? formatTime(inst, siteTz),
        location: override.location ?? master.location ?? undefined,
      });
      continue;
    }
    schedule.push({
      date: originalDate,
      start_time: formatTime(inst, siteTz),
      location: master.location || undefined,
    });
  }

  return { kind: 'schedule', schedule };
}

function indexOverridesByOriginalDate(
  overrides: ICAL.Event[],
  siteTz: string,
): Map<string, ScheduleOverride> {
  const out = new Map<string, ScheduleOverride>();
  for (const ovr of overrides) {
    const recurId = ovr.component.getFirstPropertyValue('recurrence-id') as ICAL.Time | null;
    if (!recurId) continue;
    const originalInst = timeToUtcInstant(recurId, siteTz);
    const originalDate = formatDateOnly(originalInst, siteTz);
    const status = stringPropOrUndefined(ovr.component, 'status');
    if ((status ?? '').toUpperCase() === 'CANCELLED') {
      out.set(originalDate, { date: originalDate, cancelled: true });
      continue;
    }
    if (!ovr.startDate) continue;
    const newInst = timeToUtcInstant(ovr.startDate, siteTz);
    out.set(originalDate, {
      date: formatDateOnly(newInst, siteTz),
      start_time: formatTime(newInst, siteTz),
      location: ovr.location || undefined,
    });
  }
  return out;
}

function rruleByDay(rrule: ICAL.Recur): string[] {
  // BYDAY values may be like "MO", "1MO" (first Monday), "-1FR" — for the
  // clean-weekly check we only care about the day suffix.
  return (rrule.parts?.BYDAY ?? []).map(v => v.replace(/^[+-]?\d+/, ''));
}

function stringPropOrUndefined(comp: ICAL.Component, name: string): string | undefined {
  const v = comp.getFirstPropertyValue(name);
  if (v == null) return undefined;
  return String(v);
}

/**
 * Convert an ICAL.Time to a UTC Date instant.
 *
 * - VALUE=DATE (all-day): return a Date constructed at server-local midnight
 *   for the calendar Y/M/D. On Workers (UTC) this yields a UTC midnight Date
 *   whose local-time getters round-trip to the authored Y/M/D. Matches the
 *   behavior the existing renderDateTime helper expects.
 * - Floating times (no Z, no TZID): treat the wall-clock as siteTz local
 *   time and compute the UTC instant whose siteTz projection matches.
 * - UTC and TZID-resolved times: trust ICAL.Time.toJSDate().
 */
function timeToUtcInstant(t: ICAL.Time, siteTz: string): Date {
  if (t.isDate) {
    return new Date(t.year, t.month - 1, t.day);
  }
  const zone = t.zone;
  const isFloating =
    zone == null ||
    (zone === ICAL.Timezone.localTimezone) ||
    (typeof zone.tzid === 'string' && zone.tzid === 'floating');
  if (!isFloating) {
    return t.toJSDate();
  }
  // Floating: interpret wall-clock in siteTz.
  return wallClockToUtc(
    { year: t.year, month: t.month, day: t.day, hour: t.hour, minute: t.minute, second: t.second },
    siteTz,
  );
}

interface WallClock {
  year: number; month: number; day: number;
  hour: number; minute: number; second: number;
}

/**
 * Given a wall clock and an IANA TZ, return the UTC instant whose projection
 * into that TZ equals the given wall clock. Works around the lack of a tzdata
 * library by sampling the offset of a candidate UTC instant via Intl.
 */
function wallClockToUtc(wc: WallClock, tz: string): Date {
  const candidate = Date.UTC(wc.year, wc.month - 1, wc.day, wc.hour, wc.minute, wc.second);
  const projected = getLocalParts(new Date(candidate), tz);
  const projectedMs = Date.UTC(
    Number(projected.year), Number(projected.month) - 1, Number(projected.day),
    Number(projected.hour), Number(projected.minute), Number(projected.second),
  );
  const offsetMs = projectedMs - candidate;
  return new Date(candidate - offsetMs);
}

/**
 * Render a UTC Date as the naive string downstream YAML expects.
 *
 * - All-day events → `YYYY-MM-DD` from local-time getters. Construction in
 *   timeToUtcInstant uses local midnight; on Workers (UTC) local getters
 *   yield the authored calendar date.
 * - Timed events → `YYYY-MM-DDTHH:MM:SS` projected into siteTz, no offset.
 */
function renderDateTime(d: Date, isAllDay: boolean, siteTz: string): string {
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

import ICAL from 'ical.js';
import { Temporal } from '@js-temporal/polyfill';
import type { ParsedFeed, ParsedSeries, ParsedVEvent, RecurrenceDay } from '../calendar-suggestions/types';
import { detectImplicitSeries, icalTimeToSiteZdt } from '../calendar-suggestions/detect-implicit-series';

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

  // Split masters by RRULE presence: RRULE masters use the existing per-master
  // path; non-RRULE masters go through implicit-series detection first, with
  // orphans falling back to mapOneOff. See
  // ~/code/bike-app/docs/plans/2026-04-28-implicit-series-detection-design.md.
  const rruleMasters: Array<[string, ICAL.Event]> = [];
  const plainMasters: ICAL.Event[] = [];
  for (const [uid, master] of masters) {
    if (master.component.hasProperty('rrule')) rruleMasters.push([uid, master]);
    else plainMasters.push(master);
  }

  for (const [uid, master] of rruleMasters) {
    const eventOverrides = overridesByUid.get(uid) ?? [];
    const out = mapSeries(master, eventOverrides, siteTz, nowInstant);
    if (out) events.push(out);
  }

  const { clusters, orphans } = detectImplicitSeries(plainMasters, siteTz);
  for (const cluster of clusters) events.push(cluster);
  for (const master of orphans) {
    const out = mapOneOff(master, siteTz);
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
  // Some upstream feeds emit SUMMARY/LOCATION with leading or trailing
  // whitespace. Trim at the parser boundary so the rest of the pipeline
  // (prefill into the editor form, suggestion display, downstream YAML)
  // never has to defensively re-trim.
  return {
    uid: ev.uid,
    summary: ev.summary.trim(),
    start: renderEventStart(ev.startDate, siteTz, isAllDay),
    end: ev.endDate ? renderEventStart(ev.endDate, siteTz, isAllDay) : undefined,
    location: ev.location?.trim() || undefined,
    description: ev.description || undefined,
    url: stringPropOrUndefined(ev.component, 'url'),
    last_modified: extractLastModified(ev.component),
  };
}

/**
 * Extract the upstream VEVENT's last-edit timestamp as ISO-8601 UTC.
 * Per RFC 5545 LAST-MODIFIED is the canonical "last edit time" of the event
 * itself; DTSTAMP is the calendar object's "creation/modification time" and is
 * a reasonable fallback when LAST-MODIFIED is absent (many feeds only emit
 * DTSTAMP). Both properties are required by the spec to be UTC ICAL.Time.
 */
function extractLastModified(comp: ICAL.Component): string | undefined {
  const lm = comp.getFirstPropertyValue('last-modified') as ICAL.Time | string | null;
  if (lm) return icalTimeToIsoUtc(lm);
  const ds = comp.getFirstPropertyValue('dtstamp') as ICAL.Time | string | null;
  if (ds) return icalTimeToIsoUtc(ds);
  return undefined;
}

function icalTimeToIsoUtc(t: ICAL.Time | string): string | undefined {
  if (typeof t === 'string') {
    const d = new Date(t);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  }
  if (typeof (t as ICAL.Time).toJSDate === 'function') {
    return (t as ICAL.Time).toJSDate().toISOString();
  }
  return undefined;
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

  const masterZdt = icalTimeToSiteZdt(master.startDate, siteTz);
  const season_start = masterZdt.toPlainDate().toString();
  const season_end = computeSeasonEnd(rrule, masterZdt, interval);

  // EXDATE values: ical.js exposes them as separate properties (one per
  // EXDATE line) and each property may carry multiple comma-separated values
  // — RFC 5545 allows `EXDATE:20260518T180000Z,20260601T180000Z` on a single
  // line, and Google Calendar emits this form. Iterate every value, not just
  // the first.
  const exdates = new Set<string>();
  for (const prop of master.component.getAllProperties('exdate')) {
    for (const val of prop.getValues()) {
      if (val && typeof (val as ICAL.Time).toJSDate === 'function') {
        exdates.add(icalTimeToSiteZdt(val as ICAL.Time, siteTz).toPlainDate().toString());
      }
    }
  }
  const exdatesSorted = [...exdates].sort();

  // RECURRENCE-ID overrides — already grouped by UID in parseIcs.
  const overrideOut: NonNullable<ParsedSeries['overrides']> = [];
  const seenOverrideKey = new Set<string>();
  for (const ovr of overrides) {
    if (!ovr.startDate) continue;
    const ovrZdt = icalTimeToSiteZdt(ovr.startDate, siteTz);
    const key = ovrZdt.toString();
    if (seenOverrideKey.has(key)) continue;
    seenOverrideKey.add(key);
    const status = stringPropOrUndefined(ovr.component, 'status');
    overrideOut.push({
      date: ovrZdt.toPlainDate().toString(),
      start_time: ovrZdt.toPlainTime().toString({ smallestUnit: 'minute' }),
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
      skip_dates: exdatesSorted.length ? exdatesSorted : undefined,
      overrides: overrideOut.length ? overrideOut : undefined,
    },
  };
}

function computeSeasonEnd(
  rrule: ICAL.Recur,
  masterZdt: Temporal.ZonedDateTime,
  interval: number,
): string {
  if (rrule.until) {
    return icalTimeToSiteZdt(rrule.until, masterZdt.timeZoneId).toPlainDate().toString();
  }
  if (rrule.count) {
    return masterZdt.add({ weeks: (rrule.count - 1) * interval }).toPlainDate().toString();
  }
  // Unbounded — cap at DTSTART + 1 year (matches the prior behavior).
  return masterZdt.add({ years: 1 }).toPlainDate().toString();
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
  const fromMs = now.getTime();
  const toMs = fromMs + SCHEDULE_HORIZON_DAYS * 24 * 3600 * 1000;

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
    const occMs = next.toJSDate().getTime();
    if (occMs > toMs) break;
    if (occMs < fromMs) continue;
    const zdt = icalTimeToSiteZdt(next, siteTz);
    const originalDate = zdt.toPlainDate().toString();
    const override = overridesByOriginalDate.get(originalDate);
    if (override?.cancelled) continue;
    if (override) {
      schedule.push({
        date: override.date,
        start_time: override.start_time ?? zdt.toPlainTime().toString({ smallestUnit: 'minute' }),
        location: override.location ?? master.location ?? undefined,
      });
      continue;
    }
    schedule.push({
      date: originalDate,
      start_time: zdt.toPlainTime().toString({ smallestUnit: 'minute' }),
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
    const originalDate = icalTimeToSiteZdt(recurId, siteTz).toPlainDate().toString();
    const status = stringPropOrUndefined(ovr.component, 'status');
    if ((status ?? '').toUpperCase() === 'CANCELLED') {
      out.set(originalDate, { date: originalDate, cancelled: true });
      continue;
    }
    if (!ovr.startDate) continue;
    const newZdt = icalTimeToSiteZdt(ovr.startDate, siteTz);
    out.set(originalDate, {
      date: newZdt.toPlainDate().toString(),
      start_time: newZdt.toPlainTime().toString({ smallestUnit: 'minute' }),
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
 * Render an event start/end as the naive string the downstream YAML expects:
 * `YYYY-MM-DD` for all-day, `YYYY-MM-DDTHH:MM:SS` for timed.
 *
 * Uses `icalTimeToSiteZdt` from `detect-implicit-series.ts` (the single source
 * of truth for projecting an `ICAL.Time` into a `Temporal.ZonedDateTime`
 * anchored at `siteTz`).
 */
function renderEventStart(t: ICAL.Time, siteTz: string, isAllDay: boolean): string {
  const zdt = icalTimeToSiteZdt(t, siteTz);
  if (isAllDay) return zdt.toPlainDate().toString();
  return zdt.toPlainDateTime().toString({ smallestUnit: 'second' });
}

const FETCH_TIMEOUT_MS = 5_000;

export async function fetchIcsFeed(url: string, siteTz: string): Promise<ParsedFeed> {
  const resp = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!resp.ok) throw new Error(`ICS fetch failed: ${resp.status} ${resp.statusText} (${url})`);
  const text = await resp.text();
  return parseIcs(text, url, siteTz);
}

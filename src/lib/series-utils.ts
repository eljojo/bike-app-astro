import { parseLocalDate, formatDateStr, endOfDay } from './date-utils';

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

export interface SeriesOccurrence {
  date: string;         // YYYY-MM-DD
  location?: string;    // override or inherited from event
  start_time?: string;  // override or inherited
  meet_time?: string;   // override or inherited
  note?: string;
  cancelled?: boolean;
  rescheduled_from?: string;
  event_url?: string;          // per-occurrence event-website URL override
  registration_url?: string;   // per-occurrence sign-up URL override
  map_url?: string;            // per-occurrence route-map URL override (e.g. RWGPS)
}

interface SeriesOverride {
  date: string;
  location?: string;
  start_time?: string;
  meet_time?: string;
  note?: string;
  cancelled?: boolean;
  rescheduled_from?: string;
  event_url?: string;
  registration_url?: string;
  map_url?: string;
}

interface SeriesData {
  recurrence?: string;
  recurrence_day?: string;
  season_start?: string;
  season_end?: string;
  skip_dates?: string[];
  overrides?: SeriesOverride[];
  schedule?: SeriesOverride[];
}

interface EventLike {
  location?: string;
  start_time?: string;
  meet_time?: string;
  series?: SeriesData;
}

/**
 * Pure projection: (date, optional override, event) → SeriesOccurrence.
 * Applies the `override.X ?? event.X` fallback rule. Internal helper — keep
 * in sync with the SeriesOccurrence interface above.
 */
function toSeriesOccurrence(
  date: string,
  override: SeriesOverride | undefined,
  event: EventLike,
): SeriesOccurrence {
  return {
    date,
    location: override?.location ?? event.location,
    start_time: override?.start_time ?? event.start_time,
    meet_time: override?.meet_time ?? event.meet_time,
    note: override?.note,
    cancelled: override?.cancelled,
    rescheduled_from: override?.rescheduled_from,
    event_url: override?.event_url,
    registration_url: override?.registration_url,
    map_url: override?.map_url,
  };
}

export function expandSeriesOccurrences(event: EventLike): SeriesOccurrence[] {
  if (!event.series) return [];
  const series = event.series;

  if (series.schedule?.length) {
    return series.schedule
      .map(s => toSeriesOccurrence(s.date, s, event))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  if (series.recurrence && series.recurrence_day && series.season_start && series.season_end) {
    const dayIndex = DAY_NAMES.indexOf(series.recurrence_day);
    const step = series.recurrence === 'biweekly' ? 14 : 7;
    const skipSet = new Set(series.skip_dates ?? []);
    const overrideMap = new Map((series.overrides ?? []).map(o => [o.date, o]));

    const dates: SeriesOccurrence[] = [];
    const cursor = parseLocalDate(series.season_start);
    const end = parseLocalDate(series.season_end);

    // Advance to first matching day
    while (cursor.getDay() !== dayIndex && cursor <= end) {
      cursor.setDate(cursor.getDate() + 1);
    }

    while (cursor <= end) {
      const dateStr = formatDateStr(cursor);
      if (!skipSet.has(dateStr)) {
        dates.push(toSeriesOccurrence(dateStr, overrideMap.get(dateStr), event));
      }
      cursor.setDate(cursor.getDate() + step);
    }

    // Add rescheduled dates not on the regular cadence
    for (const override of series.overrides ?? []) {
      if (!dates.some(d => d.date === override.date)) {
        dates.push(toSeriesOccurrence(override.date, override, event));
      }
    }

    return dates.sort((a, b) => a.date.localeCompare(b.date));
  }

  return [];
}

export function isSeriesEvent(event: { series?: unknown }): boolean {
  return event.series != null;
}

export function getNextOccurrence(occurrences: SeriesOccurrence[], now: Date): SeriesOccurrence | undefined {
  return occurrences.find(o => !o.cancelled && endOfDay(o.date) >= now);
}

export function isSeriesActive(occurrences: SeriesOccurrence[], now: Date): boolean {
  return getNextOccurrence(occurrences, now) !== undefined;
}

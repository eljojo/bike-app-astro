import { describe, it, expect } from 'vitest';
import { expandSeriesOccurrences, isSeriesEvent } from '../../src/lib/series-utils';
import { formatMonthName } from '../../src/lib/date-utils';

// --------------------------------------------------------------------------
// Replicate the calendar expansion pattern from calendar.astro
// --------------------------------------------------------------------------

interface CalendarEntry {
  event: { id: string; data: Record<string, unknown> };
  occurrenceDate?: string;
  occurrenceLocation?: string;
}

function effectiveDate(entry: CalendarEntry): string {
  return entry.occurrenceDate || (entry.event.data.start_date as string);
}

function expandEvents(events: CalendarEntry['event'][]): CalendarEntry[] {
  const expanded: CalendarEntry[] = [];
  for (const event of events) {
    if (isSeriesEvent(event.data)) {
      const occurrences = expandSeriesOccurrences(event.data as any);
      for (const occ of occurrences) {
        if (!occ.cancelled) {
          expanded.push({
            event,
            occurrenceDate: occ.date,
            occurrenceLocation: occ.location,
          });
        }
      }
    } else {
      expanded.push({ event });
    }
  }
  return expanded;
}

function deduplicateSeries(entries: CalendarEntry[]): CalendarEntry[] {
  const seen = new Set<string>();
  const result: CalendarEntry[] = [];
  for (const entry of entries) {
    const id = entry.event.id;
    if (isSeriesEvent(entry.event.data)) {
      if (seen.has(id)) continue;
      seen.add(id);
    }
    result.push(entry);
  }
  return result;
}

function groupByMonth(entries: CalendarEntry[], locale = 'en-CA') {
  const groups: Record<string, CalendarEntry[]> = {};
  for (const entry of entries) {
    const month = formatMonthName(effectiveDate(entry), locale);
    if (!groups[month]) groups[month] = [];
    groups[month].push(entry);
  }
  return groups;
}

// --------------------------------------------------------------------------
// Replicate the iCal VEVENT generation pattern from calendar.ics.ts
// --------------------------------------------------------------------------

function escapeIcal(text: string): string {
  return text.replace(/[\\;,\n]/g, (m) => {
    if (m === '\n') return '\\n';
    return `\\${m}`;
  });
}

function formatIcalDate(dateStr: string): string {
  return dateStr.replace(/-/g, '');
}

function formatIcalTime(timeStr: string): string {
  return timeStr.replace(/:/g, '') + '00';
}

interface VEvent {
  uid: string;
  summary: string;
  dtstart: string;
  location?: string;
  description?: string;
}

function buildVEventsForEvent(
  event: { id: string; data: Record<string, unknown> },
  domain: string,
  timezone: string,
): VEvent[] {
  const e = event.data;
  const vevents: VEvent[] = [];

  if (isSeriesEvent(e)) {
    const occurrences = expandSeriesOccurrences(e as any);
    for (const occ of occurrences) {
      if (occ.cancelled) continue;
      const uid = `${event.id}-${occ.date}@${domain}`;
      const time = occ.start_time;
      let dtstart: string;
      if (time) {
        dtstart = `DTSTART;TZID=${timezone}:${formatIcalDate(occ.date)}T${formatIcalTime(time)}`;
      } else {
        dtstart = `DTSTART;VALUE=DATE:${formatIcalDate(occ.date)}`;
      }

      const descParts: string[] = [];
      if (occ.meet_time && time) {
        descParts.push(`Meet: ${occ.meet_time}, Roll: ${time}`);
      }
      if (e.distances) descParts.push(e.distances as string);

      vevents.push({
        uid,
        summary: escapeIcal(e.name as string),
        dtstart,
        location: occ.location ? escapeIcal(occ.location) : undefined,
        description: descParts.length ? escapeIcal(descParts.join('\\n')) : undefined,
      });
    }
  } else {
    const uid = `${event.id}@${domain}`;
    const time = e.start_time as string | undefined;
    let dtstart: string;
    if (time) {
      dtstart = `DTSTART;TZID=${timezone}:${formatIcalDate(e.start_date as string)}T${formatIcalTime(time)}`;
    } else {
      dtstart = `DTSTART;VALUE=DATE:${formatIcalDate(e.start_date as string)}`;
    }
    vevents.push({
      uid,
      summary: escapeIcal(e.name as string),
      dtstart,
      location: e.location ? escapeIcal(e.location as string) : undefined,
      description: e.distances ? escapeIcal(e.distances as string) : undefined,
    });
  }

  return vevents;
}

// --------------------------------------------------------------------------
// Test fixtures
// --------------------------------------------------------------------------

const weeklySeries = {
  id: '2026/park-loops',
  data: {
    name: 'Park Loops',
    start_date: '2026-06-02',
    start_time: '18:00',
    meet_time: '17:45',
    location: 'Park P3',
    series: {
      recurrence: 'weekly',
      recurrence_day: 'tuesday',
      season_start: '2026-06-02',
      season_end: '2026-06-30',
      skip_dates: ['2026-06-16'],
      overrides: [
        { date: '2026-06-23', location: 'Champlain Lookout', note: 'Special ride' },
        { date: '2026-06-09', cancelled: true },
      ],
    },
  },
};

const scheduleSeries = {
  id: '2026/ottbike-social',
  data: {
    name: '#OttBike Social',
    start_time: '19:00',
    meet_time: '18:45',
    location: 'Default CC',
    series: {
      schedule: [
        { date: '2026-01-08', location: 'Overbrook CC' },
        { date: '2026-01-22', location: 'Hintonburg CC' },
        { date: '2026-02-05' },
      ],
    },
  },
};

const oneOffEvent = {
  id: '2026/bike-fest',
  data: {
    name: 'Bike Fest',
    start_date: '2026-07-15',
    start_time: '09:00',
    location: 'City Hall',
    distances: '50k',
  },
};

const oneOffAllDay = {
  id: '2026/swap-meet',
  data: {
    name: 'Bike Swap',
    start_date: '2026-08-01',
    location: 'Community Centre',
  },
};

// --------------------------------------------------------------------------
// Calendar expansion tests
// --------------------------------------------------------------------------

describe('calendar expansion — series events', () => {
  it('expands weekly series into individual entries', () => {
    const entries = expandEvents([weeklySeries]);
    // 5 Tuesdays in range: Jun 2, 9, 16, 23, 30
    // skip_dates removes Jun 16, cancelled Jun 9 is excluded, plus Jun 23, Jun 30
    // The remaining non-cancelled: Jun 2, Jun 23, Jun 30
    const dates = entries.map(e => e.occurrenceDate);
    expect(dates).toContain('2026-06-02');
    expect(dates).toContain('2026-06-23');
    expect(dates).toContain('2026-06-30');
    // Cancelled occurrence (Jun 9) excluded from calendar entries
    expect(dates).not.toContain('2026-06-09');
    // Skipped date excluded
    expect(dates).not.toContain('2026-06-16');
  });

  it('shows correct location for overridden occurrence', () => {
    const entries = expandEvents([weeklySeries]);
    const jun23 = entries.find(e => e.occurrenceDate === '2026-06-23');
    expect(jun23?.occurrenceLocation).toBe('Champlain Lookout');
  });

  it('shows default location for non-overridden occurrence', () => {
    const entries = expandEvents([weeklySeries]);
    const jun2 = entries.find(e => e.occurrenceDate === '2026-06-02');
    expect(jun2?.occurrenceLocation).toBe('Park P3');
  });

  it('expands explicit schedule series', () => {
    const entries = expandEvents([scheduleSeries]);
    expect(entries).toHaveLength(3);
    expect(entries.map(e => e.occurrenceDate)).toEqual([
      '2026-01-08', '2026-01-22', '2026-02-05',
    ]);
  });

  it('uses per-entry location from schedule, falls back to event location', () => {
    const entries = expandEvents([scheduleSeries]);
    expect(entries[0].occurrenceLocation).toBe('Overbrook CC');
    expect(entries[1].occurrenceLocation).toBe('Hintonburg CC');
    expect(entries[2].occurrenceLocation).toBe('Default CC');
  });

  it('leaves non-series events unaffected', () => {
    const entries = expandEvents([oneOffEvent]);
    expect(entries).toHaveLength(1);
    expect(entries[0].occurrenceDate).toBeUndefined();
    expect(entries[0].event.id).toBe('2026/bike-fest');
  });

  it('handles mix of series and non-series events', () => {
    const entries = expandEvents([weeklySeries, oneOffEvent, scheduleSeries]);
    const seriesEntries = entries.filter(e => e.occurrenceDate !== undefined);
    const nonSeriesEntries = entries.filter(e => e.occurrenceDate === undefined);
    expect(seriesEntries.length).toBeGreaterThan(1);
    expect(nonSeriesEntries).toHaveLength(1);
    expect(nonSeriesEntries[0].event.id).toBe('2026/bike-fest');
  });
});

describe('calendar expansion — month grouping', () => {
  it('groups series occurrences into correct months', () => {
    const entries = expandEvents([scheduleSeries]);
    const months = groupByMonth(entries);
    expect(Object.keys(months)).toHaveLength(2);
    const monthNames = Object.keys(months);
    expect(monthNames[0]).toMatch(/January/i);
    expect(monthNames[1]).toMatch(/February/i);
    expect(months[monthNames[0]]).toHaveLength(2);
    expect(months[monthNames[1]]).toHaveLength(1);
  });

  it('groups non-series event by its start_date month', () => {
    const entries = expandEvents([oneOffEvent]);
    const months = groupByMonth(entries);
    const monthNames = Object.keys(months);
    expect(monthNames).toHaveLength(1);
    expect(monthNames[0]).toMatch(/July/i);
  });
});

describe('calendar expansion — deduplication', () => {
  it('shows each series event once after deduplication', () => {
    const entries = expandEvents([weeklySeries]);
    expect(entries.length).toBeGreaterThan(1);
    const deduped = deduplicateSeries(entries);
    expect(deduped).toHaveLength(1);
    expect(deduped[0].event.id).toBe('2026/park-loops');
  });

  it('preserves all non-series events during deduplication', () => {
    const entries = expandEvents([weeklySeries, oneOffEvent, oneOffAllDay]);
    const deduped = deduplicateSeries(entries);
    const ids = deduped.map(e => e.event.id);
    expect(ids).toContain('2026/park-loops');
    expect(ids).toContain('2026/bike-fest');
    expect(ids).toContain('2026/swap-meet');
    expect(ids.filter(id => id === '2026/park-loops')).toHaveLength(1);
  });

  it('deduplicates multiple series independently', () => {
    const entries = expandEvents([weeklySeries, scheduleSeries, oneOffEvent]);
    const deduped = deduplicateSeries(entries);
    const seriesIds = deduped
      .filter(e => isSeriesEvent(e.event.data))
      .map(e => e.event.id);
    expect(seriesIds).toEqual(['2026/park-loops', '2026/ottbike-social']);
  });
});

// --------------------------------------------------------------------------
// iCal generation tests
// --------------------------------------------------------------------------

const DOMAIN = 'ottawabybike.ca'; // eslint-disable-line bike-app/no-hardcoded-city-locale -- test fixture
const TIMEZONE = 'America/Toronto';

describe('iCal generation — series events', () => {
  it('produces one VEVENT per non-cancelled occurrence', () => {
    const vevents = buildVEventsForEvent(weeklySeries, DOMAIN, TIMEZONE);
    // 5 Tuesdays (Jun 2, 9, 16, 23, 30), minus skip (16), cancelled (9) stays as occurrence but excluded
    // Actually: cancelled Jun 9 is excluded by `if (occ.cancelled) continue`
    // skip Jun 16 is excluded by skip_dates
    // Result: Jun 2, Jun 23, Jun 30
    expect(vevents).toHaveLength(3);
    const dates = vevents.map(v => v.uid);
    expect(dates).not.toContainEqual(expect.stringContaining('2026-06-09'));
    expect(dates).not.toContainEqual(expect.stringContaining('2026-06-16'));
  });

  it('generates unique UIDs per occurrence with {eventId}-{date}@domain pattern', () => {
    const vevents = buildVEventsForEvent(weeklySeries, DOMAIN, TIMEZONE);
    const uids = vevents.map(v => v.uid);
    // All unique
    expect(new Set(uids).size).toBe(uids.length);
    // Pattern check
    for (const uid of uids) {
      expect(uid).toMatch(/^2026\/park-loops-2026-\d{2}-\d{2}@ottawabybike\.ca$/);
    }
  });

  it('includes overridden location in LOCATION field', () => {
    const vevents = buildVEventsForEvent(weeklySeries, DOMAIN, TIMEZONE);
    const jun23 = vevents.find(v => v.uid.includes('2026-06-23'));
    expect(jun23?.location).toBe('Champlain Lookout');
  });

  it('uses default location for non-overridden occurrences', () => {
    const vevents = buildVEventsForEvent(weeklySeries, DOMAIN, TIMEZONE);
    const jun2 = vevents.find(v => v.uid.includes('2026-06-02'));
    expect(jun2?.location).toBe('Park P3');
  });

  it('includes meet time in DESCRIPTION when set', () => {
    const vevents = buildVEventsForEvent(weeklySeries, DOMAIN, TIMEZONE);
    const jun2 = vevents.find(v => v.uid.includes('2026-06-02'));
    expect(jun2?.description).toContain('Meet: 17:45');
    expect(jun2?.description).toContain('Roll: 18:00');
  });

  it('formats DTSTART with timezone for timed occurrences', () => {
    const vevents = buildVEventsForEvent(weeklySeries, DOMAIN, TIMEZONE);
    const jun2 = vevents.find(v => v.uid.includes('2026-06-02'));
    expect(jun2?.dtstart).toBe('DTSTART;TZID=America/Toronto:20260602T180000');
  });

  it('handles explicit schedule series', () => {
    const vevents = buildVEventsForEvent(scheduleSeries, DOMAIN, TIMEZONE);
    expect(vevents).toHaveLength(3);
    expect(vevents[0].uid).toBe('2026/ottbike-social-2026-01-08@ottawabybike.ca');
    expect(vevents[0].location).toBe('Overbrook CC');
    expect(vevents[1].location).toBe('Hintonburg CC');
    expect(vevents[2].location).toBe('Default CC');
  });

  it('includes meet time for schedule series', () => {
    const vevents = buildVEventsForEvent(scheduleSeries, DOMAIN, TIMEZONE);
    expect(vevents[0].description).toContain('Meet: 18:45');
    expect(vevents[0].description).toContain('Roll: 19:00');
  });
});

describe('iCal generation — non-series events', () => {
  it('produces a single VEVENT for a one-off event', () => {
    const vevents = buildVEventsForEvent(oneOffEvent, DOMAIN, TIMEZONE);
    expect(vevents).toHaveLength(1);
    expect(vevents[0].uid).toBe('2026/bike-fest@ottawabybike.ca');
  });

  it('uses event location directly', () => {
    const vevents = buildVEventsForEvent(oneOffEvent, DOMAIN, TIMEZONE);
    expect(vevents[0].location).toBe('City Hall');
  });

  it('includes distances in description', () => {
    const vevents = buildVEventsForEvent(oneOffEvent, DOMAIN, TIMEZONE);
    expect(vevents[0].description).toBe('50k');
  });

  it('formats all-day event without time component', () => {
    const vevents = buildVEventsForEvent(oneOffAllDay, DOMAIN, TIMEZONE);
    expect(vevents[0].dtstart).toBe('DTSTART;VALUE=DATE:20260801');
  });

  it('has no description when no meet_time or distances', () => {
    const vevents = buildVEventsForEvent(oneOffAllDay, DOMAIN, TIMEZONE);
    expect(vevents[0].description).toBeUndefined();
  });
});

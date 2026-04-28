import { describe, it, expect } from 'vitest';
import { isSeriesEvent } from '../../src/lib/series-utils';
import { expandEvents, deduplicateSeries, groupByMonth } from '../../src/lib/calendar-helpers';
import { buildVEventLines } from '../../src/lib/ical-helpers';

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
// Calendar expansion tests (using production expandEvents)
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

  it('distinguishes same month in different years', () => {
    const janEvent2026 = { id: '2026/jan-ride', data: { name: 'Jan 2026', start_date: '2026-01-15' } };
    const janEvent2027 = { id: '2027/jan-ride', data: { name: 'Jan 2027', start_date: '2027-01-15' } };
    const entries = expandEvents([janEvent2026, janEvent2027]);
    const months = groupByMonth(entries);
    expect(Object.keys(months)).toHaveLength(2);
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
// iCal generation tests (using production buildVEventLines)
// --------------------------------------------------------------------------

const DOMAIN = 'ottawabybike.ca'; // eslint-disable-line bike-app/no-hardcoded-city-locale -- test fixture
const TIMEZONE = 'America/Toronto';
const DTSTAMP = '20260101T000000Z';

function findVEvent(vevents: ReturnType<typeof buildVEventLines>, uidPart: string) {
  return vevents.find(v => v.uid.includes(uidPart));
}

function getLine(lines: string[], prefix: string): string | undefined {
  return lines.find(l => l.startsWith(prefix));
}

describe('iCal generation — series events', () => {
  it('produces one VEVENT per non-cancelled occurrence', () => {
    const vevents = buildVEventLines(weeklySeries, DOMAIN, TIMEZONE, DTSTAMP);
    expect(vevents).toHaveLength(3);
    const uids = vevents.map(v => v.uid);
    expect(uids).not.toContainEqual(expect.stringContaining('2026-06-09'));
    expect(uids).not.toContainEqual(expect.stringContaining('2026-06-16'));
  });

  it('generates unique UIDs per occurrence with {eventId}-{date}@domain pattern', () => {
    const vevents = buildVEventLines(weeklySeries, DOMAIN, TIMEZONE, DTSTAMP);
    const uids = vevents.map(v => v.uid);
    expect(new Set(uids).size).toBe(uids.length);
    for (const uid of uids) {
      expect(uid).toMatch(/^2026\/park-loops-2026-\d{2}-\d{2}@ottawabybike\.ca$/);
    }
  });

  it('includes overridden location in LOCATION field', () => {
    const vevents = buildVEventLines(weeklySeries, DOMAIN, TIMEZONE, DTSTAMP);
    const jun23 = findVEvent(vevents, '2026-06-23');
    const locationLine = getLine(jun23!.lines, 'LOCATION:');
    expect(locationLine).toBe('LOCATION:Champlain Lookout');
  });

  it('uses default location for non-overridden occurrences', () => {
    const vevents = buildVEventLines(weeklySeries, DOMAIN, TIMEZONE, DTSTAMP);
    const jun2 = findVEvent(vevents, '2026-06-02');
    const locationLine = getLine(jun2!.lines, 'LOCATION:');
    expect(locationLine).toBe('LOCATION:Park P3');
  });

  it('includes meet time in DESCRIPTION when set', () => {
    const vevents = buildVEventLines(weeklySeries, DOMAIN, TIMEZONE, DTSTAMP);
    const jun2 = findVEvent(vevents, '2026-06-02');
    const descLine = getLine(jun2!.lines, 'DESCRIPTION:');
    expect(descLine).toContain('Meet: 17:45');
    expect(descLine).toContain('Roll: 18:00');
  });

  it('uses meet_time for DTSTART so the calendar shows when to be there', () => {
    const vevents = buildVEventLines(weeklySeries, DOMAIN, TIMEZONE, DTSTAMP);
    const jun2 = findVEvent(vevents, '2026-06-02');
    const dtstartLine = getLine(jun2!.lines, 'DTSTART');
    expect(dtstartLine).toBe('DTSTART;TZID=America/Toronto:20260602T174500');
  });

  it('keeps DTEND tied to start_time so the block covers the actual ride', () => {
    const vevents = buildVEventLines(weeklySeries, DOMAIN, TIMEZONE, DTSTAMP);
    const jun2 = findVEvent(vevents, '2026-06-02');
    const dtendLine = getLine(jun2!.lines, 'DTEND');
    // start_time is 18:00, fallback adds one hour → 19:00
    expect(dtendLine).toBe('DTEND;TZID=America/Toronto:20260602T190000');
  });

  it('handles explicit schedule series', () => {
    const vevents = buildVEventLines(scheduleSeries, DOMAIN, TIMEZONE, DTSTAMP);
    expect(vevents).toHaveLength(3);
    expect(vevents[0].uid).toBe('2026/ottbike-social-2026-01-08@ottawabybike.ca');
    expect(getLine(vevents[0].lines, 'LOCATION:')).toBe('LOCATION:Overbrook CC');
    expect(getLine(vevents[1].lines, 'LOCATION:')).toBe('LOCATION:Hintonburg CC');
    expect(getLine(vevents[2].lines, 'LOCATION:')).toBe('LOCATION:Default CC');
  });

  it('includes meet time for schedule series', () => {
    const vevents = buildVEventLines(scheduleSeries, DOMAIN, TIMEZONE, DTSTAMP);
    const descLine = getLine(vevents[0].lines, 'DESCRIPTION:');
    expect(descLine).toContain('Meet: 18:45');
    expect(descLine).toContain('Roll: 19:00');
  });
});

describe('iCal generation — non-series events', () => {
  it('produces a single VEVENT for a one-off event', () => {
    const vevents = buildVEventLines(oneOffEvent, DOMAIN, TIMEZONE, DTSTAMP);
    expect(vevents).toHaveLength(1);
    expect(vevents[0].uid).toBe('2026/bike-fest@ottawabybike.ca');
  });

  it('uses event location directly', () => {
    const vevents = buildVEventLines(oneOffEvent, DOMAIN, TIMEZONE, DTSTAMP);
    expect(getLine(vevents[0].lines, 'LOCATION:')).toBe('LOCATION:City Hall');
  });

  it('includes distances in description', () => {
    const vevents = buildVEventLines(oneOffEvent, DOMAIN, TIMEZONE, DTSTAMP);
    expect(getLine(vevents[0].lines, 'DESCRIPTION:')).toBe('DESCRIPTION:50k');
  });

  it('formats all-day event without time component', () => {
    const vevents = buildVEventLines(oneOffAllDay, DOMAIN, TIMEZONE, DTSTAMP);
    expect(getLine(vevents[0].lines, 'DTSTART')).toBe('DTSTART;VALUE=DATE:20260801');
  });

  it('has no description when no meet_time or distances', () => {
    const vevents = buildVEventLines(oneOffAllDay, DOMAIN, TIMEZONE, DTSTAMP);
    expect(getLine(vevents[0].lines, 'DESCRIPTION:')).toBeUndefined();
  });
});

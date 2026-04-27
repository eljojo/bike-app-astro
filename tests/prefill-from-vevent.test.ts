import { describe, test, expect } from 'vitest';
import type { ParsedVEvent } from '../src/lib/calendar-suggestions/types';
import { buildCopyDataFromVevent } from '../src/lib/calendar-suggestions/prefill';

describe('buildCopyDataFromVevent', () => {
  test('one-off with time — date/time split', () => {
    const v: ParsedVEvent = {
      uid: 'oneoff@x',
      summary: 'Coffee Ride',
      start: '2026-05-10T18:00:00.000Z',
      end: '2026-05-10T20:00:00.000Z',
      location: 'Park',
      description: 'Easy 20km',
      url: 'https://example.com/e/1',
    };
    const cd = buildCopyDataFromVevent(v, 'qbc');
    expect(cd).toMatchObject({
      name: 'Coffee Ride',
      start_date: '2026-05-10',
      start_time: '18:00',
      end_date: '2026-05-10',
      end_time: '20:00',
      location: 'Park',
      body: 'Easy 20km',
      event_url: 'https://example.com/e/1',
      organizer: 'qbc',
      ics_uid: 'oneoff@x',
    });
    expect(cd.series).toBeUndefined();
  });

  test('all-day event (start has no time component)', () => {
    const v: ParsedVEvent = {
      uid: 'allday@x',
      summary: 'Community Day',
      start: '2026-06-12',
    };
    const cd = buildCopyDataFromVevent(v, 'qbc');
    expect(cd.start_date).toBe('2026-06-12');
    expect(cd.start_time).toBeUndefined();
    expect(cd.end_date).toBeUndefined();
    expect(cd.end_time).toBeUndefined();
  });

  test('series with clean recurrence — includes series block', () => {
    const v: ParsedVEvent = {
      uid: 'series@x',
      summary: 'Every Monday',
      start: '2026-05-04T18:00:00.000Z',
      series: {
        kind: 'recurrence',
        recurrence: 'weekly',
        recurrence_day: 'monday',
        season_start: '2026-05-04',
        season_end: '2026-09-28',
        skip_dates: ['2026-05-18'],
      },
    };
    const cd = buildCopyDataFromVevent(v, 'qbc');
    expect(cd.start_date).toBe('2026-05-04');       // season_start takes precedence for start_date
    expect(cd.start_time).toBe('18:00');
    expect(cd.ics_uid).toBe('series@x');
    expect(cd.series).toEqual({
      recurrence: 'weekly',
      recurrence_day: 'monday',
      season_start: '2026-05-04',
      season_end: '2026-09-28',
      skip_dates: ['2026-05-18'],
    });
    // Absent fields must not appear as explicit undefined keys — YAML would emit them as nulls.
    expect(Object.keys(cd.series as Record<string, unknown>)).not.toContain('overrides');
  });

  test('series with no EXDATE/overrides omits skip_dates/overrides entirely', () => {
    const v: ParsedVEvent = {
      uid: 'series-clean@x',
      summary: 'Every Monday',
      start: '2026-05-04T18:00:00.000Z',
      series: {
        kind: 'recurrence',
        recurrence: 'weekly',
        recurrence_day: 'monday',
        season_start: '2026-05-04',
        season_end: '2026-09-28',
      },
    };
    const cd = buildCopyDataFromVevent(v, 'qbc');
    const seriesKeys = Object.keys(cd.series as Record<string, unknown>);
    expect(seriesKeys).not.toContain('skip_dates');
    expect(seriesKeys).not.toContain('overrides');
    expect(seriesKeys.sort()).toEqual(['recurrence', 'recurrence_day', 'season_end', 'season_start']);
  });

  test('HTML descriptions are converted to markdown for the body', () => {
    // Real-world Google-Calendar-flavored HTML — <br>, <a href>, <u>, and the
    // ridewithgps URL appears both as href and as the anchor's visible text.
    const v: ParsedVEvent = {
      uid: 'html-desc@x',
      summary: 'Sunday club ride',
      start: '2026-05-10T10:00:00',
      description:
        '<br><a href="https://ridewithgps.com/routes/35268576"><u>https://ridewithgps.com/routes/35268576</u></a><br><br>' +
        'We&#39;ll do a 43 km loop. Aim for &gt; 20 km/h.<br>Bring: lights.',
    };
    const cd = buildCopyDataFromVevent(v, 'qbc');
    const body = cd.body as string;
    // No HTML tags survive (matches `<br>`, `</u>`, `<a href=...>`; allows
    // markdown autolinks `<https://...>` because they contain `:` after the
    // host scheme — not a valid HTML tag-name shape).
    expect(body).not.toMatch(/<\/?[a-zA-Z]\w*(?:\s[^>]*)?\/?>/);
    // HTML entities decoded.
    expect(body).toContain("We'll do");
    expect(body).toContain('> 20 km/h');
    // RidewithGPS URL still present (likely as a markdown autolink).
    expect(body).toContain('https://ridewithgps.com/routes/35268576');
    // map_url is extracted from the same source.
    expect(cd.map_url).toBe('https://ridewithgps.com/routes/35268576');
  });

  test('extracts a RidewithGPS URL from the description into map_url', () => {
    const v: ParsedVEvent = {
      uid: 'with-rwgps@x',
      summary: 'Sunday club ride',
      start: '2026-05-10T10:00:00',
      description: 'Join us! Route: https://ridewithgps.com/routes/35268576 — bring lights.',
    };
    const cd = buildCopyDataFromVevent(v, 'qbc');
    expect(cd.map_url).toBe('https://ridewithgps.com/routes/35268576');
    // Description is preserved verbatim — admin can edit if they want it gone.
    expect(cd.body).toBe('Join us! Route: https://ridewithgps.com/routes/35268576 — bring lights.');
  });

  test('does not set map_url when the description has no RidewithGPS link', () => {
    const v: ParsedVEvent = {
      uid: 'no-link@x',
      summary: 'Sunday club ride',
      start: '2026-05-10T10:00:00',
      description: 'Easy 30km. Meet at the cafe.',
    };
    const cd = buildCopyDataFromVevent(v, 'qbc');
    expect(cd.map_url).toBeUndefined();
  });

  test('picks the first RidewithGPS URL when multiple are present', () => {
    const v: ParsedVEvent = {
      uid: 'multi-rwgps@x',
      summary: 'Choose your distance',
      start: '2026-05-10T10:00:00',
      description: '50km: https://ridewithgps.com/routes/111 / 80km: https://ridewithgps.com/routes/222',
    };
    const cd = buildCopyDataFromVevent(v, 'qbc');
    expect(cd.map_url).toBe('https://ridewithgps.com/routes/111');
  });

  test('series with schedule fallback — includes schedule list', () => {
    const v: ParsedVEvent = {
      uid: 'sched@x',
      summary: 'First Sunday',
      start: '2026-05-03T10:00:00.000Z',
      series: {
        kind: 'schedule',
        schedule: [
          { date: '2026-05-03', start_time: '10:00' },
          { date: '2026-06-07', start_time: '10:00' },
        ],
      },
    };
    const cd = buildCopyDataFromVevent(v, 'qbc');
    expect(cd.series).toEqual({
      schedule: [
        { date: '2026-05-03', start_time: '10:00' },
        { date: '2026-06-07', start_time: '10:00' },
      ],
    });
    // schedule-series also has season_start? probably not — fall back to slicing start
    expect(cd.start_date).toBe('2026-05-03');
  });
});

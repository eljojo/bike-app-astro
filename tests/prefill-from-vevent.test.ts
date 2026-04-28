import { describe, test, expect } from 'vitest';
import type { ParsedVEvent, ParsedFeed } from '../src/lib/calendar-suggestions/types';
import { buildCopyDataFromVevent, findVeventForPrefill } from '../src/lib/calendar-suggestions/prefill';

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

describe('findVeventForPrefill — dissolved-cluster uid resolution', () => {
  test('BUG: uid that lives only in cluster overrides is unfindable via top-level lookup', () => {
    // After Task 8 dissolves a cluster into one-offs, a suggestion may carry
    // the per-occurrence uid 'g' (one of the cluster's surviving overrides).
    // event-new.astro's prefill currently does feed.events.find(e => e.uid),
    // which only sees the cluster master ('a'). Looking up 'g' returns
    // undefined and the admin sees "no longer in source calendar" — even
    // though the data is right there inside cluster.series.overrides.
    const feed: ParsedFeed = {
      fetched_at: '2026-04-28T00:00:00Z',
      source_url: 'https://example.com/feed.ics',
      events: [{
        uid: 'a',
        summary: 'Wednesday Coffee Ride',
        start: '2026-05-06T10:00:00',
        location: 'Sportsplex',
        description: 'Standard ride',
        url: 'https://example.com/master',
        series: {
          kind: 'recurrence',
          recurrence: 'weekly',
          recurrence_day: 'wednesday',
          season_start: '2026-05-06',
          season_end: '2026-06-24',
          overrides: [
            { date: '2026-05-06', uid: 'a' },
            { date: '2026-05-13', uid: 'b' },
            { date: '2026-05-20', uid: 'c' },
            { date: '2026-05-27', uid: 'd' },
            { date: '2026-06-03', uid: 'e' },
            { date: '2026-06-10', uid: 'f' },
            { date: '2026-06-17', uid: 'g', event_url: 'https://example.com/g' },
            { date: '2026-06-24', uid: 'h' },
          ],
        },
      }],
    };
    // The bug: top-level find can't see dissolved-cluster uids.
    expect(feed.events.find(e => e.uid === 'g')).toBeUndefined();
    // The fix: findVeventForPrefill walks cluster overrides and synthesizes
    // a one-off ParsedVEvent.
    const v = findVeventForPrefill(feed, 'g');
    expect(v).toBeDefined();
    expect(v?.uid).toBe('g');
    expect(v?.summary).toBe('Wednesday Coffee Ride');
    expect(v?.start).toBe('2026-06-17T10:00:00');
    // Override-level event_url wins over master url.
    expect(v?.url).toBe('https://example.com/g');
    // Master fields fill in unset override fields.
    expect(v?.location).toBe('Sportsplex');
    expect(v?.description).toBe('Standard ride');
  });

  test('findVeventForPrefill skips cancelled-skip rows (no real VEVENT to import)', () => {
    const feed: ParsedFeed = {
      fetched_at: '2026-04-28T00:00:00Z',
      source_url: 'https://example.com/feed.ics',
      events: [{
        uid: 'a',
        summary: 'Coffee Ride',
        start: '2026-05-06T10:00:00',
        series: {
          kind: 'recurrence',
          season_start: '2026-05-06',
          season_end: '2026-05-13',
          overrides: [
            { date: '2026-05-06', uid: 'a' },
            { date: '2026-05-20', cancelled: true },  // missed-week placeholder
          ],
        },
      }],
    };
    // No uid on the cancelled row, but if a stray request supplied a synthetic
    // uid that happens to match a cancelled date, we should not synthesize.
    expect(findVeventForPrefill(feed, 'nonexistent')).toBeUndefined();
  });
});

describe('buildCopyDataFromVevent — top-level registration_url passthrough', () => {
  test('BUG: top-level registration_url is dropped when present on the master event', () => {
    // The implicit-series detector now produces a top-level
    // registration_url on cluster masters (modal-promoted RidewithGPS link).
    // prefill must preserve it on the copyData so the new-event form is
    // pre-filled and the saved event keeps the link.
    const v: ParsedVEvent = {
      uid: 'master',
      summary: 'Wednesday Coffee Ride',
      start: '2026-05-06T10:00:00',
      registration_url: 'https://ridewithgps.com/events/12345',
      series: {
        kind: 'recurrence',
        recurrence: 'weekly',
        recurrence_day: 'wednesday',
        season_start: '2026-05-06',
        season_end: '2026-05-27',
      },
    };
    const data = buildCopyDataFromVevent(v, 'obc');
    expect((data as Record<string, unknown>).registration_url).toBe('https://ridewithgps.com/events/12345');
  });
});

describe('buildCopyDataFromVevent — implicit series overrides pass through', () => {
  test('forwards uid, event_url, map_url, registration_url on each override', () => {
    const v: ParsedVEvent = {
      uid: 'master-uid',
      summary: 'Wednesday Coffee Ride',
      start: '2026-05-06T14:00:00',
      series: {
        kind: 'recurrence',
        recurrence: 'weekly',
        recurrence_day: 'wednesday',
        season_start: '2026-05-06',
        season_end: '2026-05-13',
        overrides: [
          {
            date: '2026-05-13',
            uid: 'occ-2',
            event_url: 'https://example.com/2',
            map_url: 'https://maps.app.goo.gl/abc',
            registration_url: 'https://register.com/2',
            note: 'West Carleton',
          },
        ],
      },
    };
    const data = buildCopyDataFromVevent(v, 'obc');
    const series = data.series as Record<string, unknown>;
    const overrides = series.overrides as Array<Record<string, unknown>>;
    expect(overrides[0].uid).toBe('occ-2');
    expect(overrides[0].event_url).toBe('https://example.com/2');
    expect(overrides[0].map_url).toBe('https://maps.app.goo.gl/abc');
    expect(overrides[0].registration_url).toBe('https://register.com/2');
    expect(overrides[0].note).toBe('West Carleton');
  });
});

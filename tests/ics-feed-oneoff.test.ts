import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseIcs } from '../src/lib/external/ics-feed.server';

function fixture(name: string): string {
  return readFileSync(path.join('tests/fixtures/ics', name), 'utf-8');
}

const TORONTO = 'America/Toronto';

describe('parseIcs — one-off events', () => {
  test('VEVENT with time (Z literal): projects into siteTz, emits naive local clock', () => {
    // DTSTART:20260510T180000Z (18:00 UTC). siteTz=America/Toronto.
    // 18:00 UTC = 14:00 EDT, so the user-facing local clock for a Toronto site is 14:00.
    const feed = parseIcs(fixture('one-off-with-time.ics'), 'https://example.com/feed.ics', TORONTO);
    expect(feed.events).toHaveLength(1);
    const e = feed.events[0];
    expect(e.uid).toBe('test-oneoff-time@example.com');
    expect(e.summary).toBe('Friday Coffee Ride');
    expect(e.start).toBe('2026-05-10T14:00:00');  // naive local; no offset, no Z
    expect(e.end).toBe('2026-05-10T16:00:00');
    expect(e.location).toBe('Queer Bike HQ');
    expect(e.description).toBe('Easy 20km along the river');
    expect(e.url).toBe('https://example.com/events/1');
    expect(e.series).toBeUndefined();
  });

  test('VEVENT all-day: start/end are date-only strings (no time component)', () => {
    const feed = parseIcs(fixture('one-off-all-day.ics'), 'https://example.com/feed.ics', TORONTO);
    expect(feed.events).toHaveLength(1);
    const e = feed.events[0];
    expect(e.uid).toBe('test-oneoff-allday@example.com');
    expect(e.summary).toBe('Community Bike Day');
    // Exact date string — not .slice(0,10), which would mask timezone drift bugs where
    // all-day Dates parse as the wrong calendar day in non-UTC environments.
    // All-day events are timezone-less by construction; the parser constructs a
    // Date at server-local midnight from the ICAL.Time Y/M/D, and on Workers
    // (UTC) local getters round-trip the authored calendar date.
    expect(e.start).toBe('2026-06-12');
    expect(e.start.length).toBe(10);
    expect(e.end).toBe('2026-06-13');
    expect(e.series).toBeUndefined();
  });

  test('VEVENT with TZID matching siteTz: emits the user-authored local clock', () => {
    const feed = parseIcs(fixture('one-off-with-tzid.ics'), 'https://example.com/feed.ics', TORONTO);
    expect(feed.events).toHaveLength(2);

    const edt = feed.events.find(e => e.uid === 'test-oneoff-tzid-edt@example.com')!;
    // Source: DTSTART;TZID=America/Toronto:20260429T181500. Project through Toronto = same.
    expect(edt.start).toBe('2026-04-29T18:15:00');
    expect(edt.end).toBe('2026-04-29T20:15:00');
    // Slicing must continue to produce naive local clock parts for prefill.
    expect(edt.start.slice(0, 10)).toBe('2026-04-29');
    expect(edt.start.slice(11, 16)).toBe('18:15');

    const est = feed.events.find(e => e.uid === 'test-oneoff-tzid-est@example.com')!;
    // Source: DTSTART;TZID=America/Toronto:20260205T140000 (EST in February). Project = same.
    expect(est.start).toBe('2026-02-05T14:00:00');
  });

  test('cross-TZ: TZID different from siteTz projects to the equivalent site-local clock', () => {
    // Vancouver event imported into a Toronto site. The platform stores naive
    // site-local clock — there's no representation for "this event is in PDT" —
    // so we project to the equivalent Toronto wall-clock time.
    const text = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//EN
BEGIN:VTIMEZONE
TZID:America/Vancouver
BEGIN:DAYLIGHT
TZOFFSETFROM:-0800
TZOFFSETTO:-0700
TZNAME:PDT
DTSTART:19700308T020000
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU
END:DAYLIGHT
END:VTIMEZONE
BEGIN:VEVENT
UID:cross-tz@example.com
SUMMARY:Vancouver event in Toronto site
DTSTART;TZID=America/Vancouver:20260429T181500
DTEND;TZID=America/Vancouver:20260429T201500
END:VEVENT
END:VCALENDAR`;
    const feed = parseIcs(text, 'https://example.com/feed.ics', TORONTO);
    // 18:15 PDT = 01:15 UTC next day = 21:15 EDT same day in Toronto.
    expect(feed.events[0].start).toBe('2026-04-29T21:15:00');
    expect(feed.events[0].end).toBe('2026-04-29T23:15:00');
  });
});

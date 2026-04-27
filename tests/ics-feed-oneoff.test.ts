import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseIcs } from '../src/lib/external/ics-feed.server';

function fixture(name: string): string {
  return readFileSync(path.join('tests/fixtures/ics', name), 'utf-8');
}

describe('parseIcs — one-off events', () => {
  test('VEVENT with time: surfaces summary, start, end, location, description, url', () => {
    const feed = parseIcs(fixture('one-off-with-time.ics'), 'https://example.com/feed.ics');
    expect(feed.events).toHaveLength(1);
    const e = feed.events[0];
    expect(e.uid).toBe('test-oneoff-time@example.com');
    expect(e.summary).toBe('Friday Coffee Ride');
    expect(e.start).toBe('2026-05-10T18:00:00.000Z');
    expect(e.end).toBe('2026-05-10T20:00:00.000Z');
    expect(e.location).toBe('Queer Bike HQ');
    expect(e.description).toBe('Easy 20km along the river');
    expect(e.url).toBe('https://example.com/events/1');
    expect(e.series).toBeUndefined();
  });

  test('VEVENT all-day: start/end are date-only strings (no time component)', () => {
    const feed = parseIcs(fixture('one-off-all-day.ics'), 'https://example.com/feed.ics');
    expect(feed.events).toHaveLength(1);
    const e = feed.events[0];
    expect(e.uid).toBe('test-oneoff-allday@example.com');
    expect(e.summary).toBe('Community Bike Day');
    // Exact date string — not .slice(0,10), which would mask timezone drift bugs where
    // all-day Dates parse as the wrong calendar day in non-UTC environments.
    expect(e.start).toBe('2026-06-12');
    expect(e.start.length).toBe(10);
    expect(e.end).toBe('2026-06-13');
    expect(e.series).toBeUndefined();
  });

  test('VEVENT with TZID: start/end render in the original zone with offset', () => {
    // Regression: timed events used to render as `toISOString()` (UTC), so prefill into
    // the new-event form pulled the UTC clock time instead of the time the user authored.
    // Fix: render `YYYY-MM-DDTHH:MM:SS±HH:MM` in the TZID's local time so slice(11,16)
    // gives the local clock time directly.
    const feed = parseIcs(fixture('one-off-with-tzid.ics'), 'https://example.com/feed.ics');
    expect(feed.events).toHaveLength(2);

    const edt = feed.events.find(e => e.uid === 'test-oneoff-tzid-edt@example.com')!;
    expect(edt.start).toBe('2026-04-29T18:15:00-04:00');
    expect(edt.end).toBe('2026-04-29T20:15:00-04:00');
    // Slicing must continue to produce the local clock parts the prefill expects.
    expect(edt.start.slice(0, 10)).toBe('2026-04-29');
    expect(edt.start.slice(11, 16)).toBe('18:15');
    // And the ISO-with-offset form must round-trip to the correct UTC instant
    // (so build.server.ts horizon checks via `new Date(start)` stay accurate).
    expect(new Date(edt.start).toISOString()).toBe('2026-04-29T22:15:00.000Z');

    const est = feed.events.find(e => e.uid === 'test-oneoff-tzid-est@example.com')!;
    expect(est.start).toBe('2026-02-05T14:00:00-05:00');  // winter: EST = -05:00
  });
});

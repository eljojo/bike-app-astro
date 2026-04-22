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
});

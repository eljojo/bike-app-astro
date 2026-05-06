import { readFileSync } from 'node:fs';
import { describe, test, expect } from 'vitest';
import { parseIcs } from '../src/lib/external/ics-feed.server';

const SITE_TZ = 'America/Toronto';

function loadFixture(name: string): string {
  return readFileSync(`tests/fixtures/ics/${name}`, 'utf8');
}

describe('parseIcs — cancelled and map_url top-level fields', () => {
  test('STATUS:CANCELLED on a one-off VEVENT becomes top-level cancelled: true', () => {
    const feed = parseIcs(loadFixture('one-off-cancelled.ics'), 'http://test/feed.ics', SITE_TZ);
    expect(feed.events).toHaveLength(1);
    expect(feed.events[0].uid).toBe('cancelled-oneoff@example.com');
    expect(feed.events[0].cancelled).toBe(true);
  });

  test('LOCATION as URL becomes top-level map_url; location stays raw', () => {
    const feed = parseIcs(loadFixture('one-off-with-map-url.ics'), 'http://test/feed.ics', SITE_TZ);
    expect(feed.events).toHaveLength(1);
    expect(feed.events[0].map_url).toBe('https://goo.gl/maps/abc123');
  });

  test('non-cancelled, non-URL events leave cancelled and map_url unset', () => {
    const feed = parseIcs(loadFixture('one-off-with-time.ics'), 'http://test/feed.ics', SITE_TZ);
    expect(feed.events).toHaveLength(1);
    expect(feed.events[0].cancelled).toBeUndefined();
    expect(feed.events[0].map_url).toBeUndefined();
  });
});

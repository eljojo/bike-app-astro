import { readFileSync } from 'node:fs';
import { describe, test, expect } from 'vitest';
import { parseIcs } from '../src/lib/external/ics-feed.server';

const SITE_TZ = 'America/Toronto';

function loadFixture(name: string): string {
  return readFileSync(`tests/fixtures/ics/${name}`, 'utf8');
}

describe('parseIcs — map_url top-level field', () => {
  test('LOCATION as URL becomes top-level map_url; location stays raw', () => {
    const feed = parseIcs(loadFixture('one-off-with-map-url.ics'), 'http://test/feed.ics', SITE_TZ);
    expect(feed.events).toHaveLength(1);
    expect(feed.events[0].map_url).toBe('https://goo.gl/maps/abc123');
  });

  test('non-URL location leaves map_url unset', () => {
    const feed = parseIcs(loadFixture('one-off-with-time.ics'), 'http://test/feed.ics', SITE_TZ);
    expect(feed.events).toHaveLength(1);
    expect(feed.events[0].map_url).toBeUndefined();
  });
});

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseIcs } from '../src/lib/external/ics-feed.server';

describe('parseIcs — OBC 2026 snapshot', () => {
  const ics = readFileSync(resolve(__dirname, 'fixtures/ics/obcrides-2026.ics'), 'utf8');
  const feed = parseIcs(
    ics,
    'https://obcrides.ca/events.ics',
    'America/Toronto',
    new Date('2026-04-28T00:00:00Z'),
  );

  it('collapses many VEVENTs into a much smaller event list', () => {
    const inputCount = (ics.match(/BEGIN:VEVENT/g) ?? []).length;
    // Sanity: output is at least 40% smaller than input. The exact ratio
    // depends on the season — OBC has many uniquely-named "Sunday Ride"
    // one-offs that resist clustering, so we use a generous bound here. The
    // real assertion of "collapse works" is the per-series tests below
    // (Wed Coffee Ride, 15km Open TT, etc.) — those each absorb 4-11 events.
    expect(feed.events.length).toBeLessThan(inputCount * 0.6);

    // Stronger check: at least 5 clusters were detected (proving the
    // implicit-series detector ran and grouped repeating events).
    const clusters = feed.events.filter(e => e.series?.kind === 'recurrence');
    expect(clusters.length).toBeGreaterThanOrEqual(5);

    // And those clusters absorbed at least 40 occurrences total — without
    // them the event list would be roughly 40 entries longer.
    const absorbed = clusters.reduce(
      (n, e) => n + (e.series?.overrides?.length ?? 0),
      0,
    );
    expect(absorbed).toBeGreaterThanOrEqual(40);
  });

  it('detects the Wednesday Coffee Ride 2026 cluster', () => {
    const cluster = feed.events.find(e =>
      e.summary === 'Wednesday Coffee Ride' && e.series?.kind === 'recurrence',
    );
    expect(cluster).toBeDefined();
    expect(cluster?.series?.recurrence).toBe('weekly');
    expect(cluster?.series?.recurrence_day).toBe('wednesday');
    expect(cluster?.series?.season_start?.startsWith('2026')).toBe(true);
    expect(cluster?.series?.season_end?.startsWith('2026')).toBe(true);
  });

  it('detects the 15km Open TT 2026 cluster as a separate series', () => {
    const tt = feed.events.find(e =>
      e.summary === '15km Open TT' && e.series?.kind === 'recurrence',
    );
    expect(tt).toBeDefined();
    expect(tt?.series?.recurrence_day).toBe('thursday');
  });

  it('preserves Almonte Paris-Roubaix as a one-off (not in a series)', () => {
    const apr = feed.events.find(e => e.summary === '2026 Almonte Paris-Roubaix');
    expect(apr).toBeDefined();
    expect(apr?.series).toBeUndefined();
  });

  it('emits per-occurrence event_url overrides on the Wed Coffee Ride cluster', () => {
    const cluster = feed.events.find(e =>
      e.summary === 'Wednesday Coffee Ride' && e.series?.kind === 'recurrence',
    );
    const overrides = cluster?.series?.overrides ?? [];
    const withUrls = overrides.filter(o => o.event_url);
    expect(withUrls.length).toBeGreaterThan(0);
    for (const o of withUrls) {
      expect(o.event_url).toMatch(/^https:\/\/obcrides\.ca\/events\/\d+$/);
      expect(o.uid).toMatch(/^https:\/\/obcrides\.ca\/events\/\d+$/);
    }
  });
});

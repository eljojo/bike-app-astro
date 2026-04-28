import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseIcs } from '../src/lib/external/ics-feed.server';

const fixture = (name: string): string =>
  readFileSync(resolve(__dirname, 'fixtures/ics', name), 'utf8');

describe('parseIcs — implicit series detection', () => {
  it('collapses 4 weekly Wednesday VEVENTs into one ParsedVEvent with kind: recurrence', () => {
    const feed = parseIcs(
      fixture('implicit-weekly-clean.ics'),
      'https://example.com/events.ics',
      'America/Toronto',
      new Date('2026-04-28T00:00:00Z'),
    );
    expect(feed.events).toHaveLength(1);
    const ev = feed.events[0];
    expect(ev.series?.kind).toBe('recurrence');
    expect(ev.series?.recurrence).toBe('weekly');
    expect(ev.series?.recurrence_day).toBe('wednesday');
    expect(ev.series?.season_start).toBe('2026-05-06');
    expect(ev.series?.season_end).toBe('2026-05-27');
    // Distinct URLs and locations → on overrides, not master.
    expect(ev.url).toBeUndefined();
    expect(ev.location).toBeUndefined();
    const overrides = ev.series?.overrides ?? [];
    expect(overrides).toHaveLength(4);
    for (const ovr of overrides) {
      expect(ovr.event_url).toMatch(/^https:\/\/example.com\/events\//);
      expect(ovr.uid).toMatch(/^test-/);
    }
  });

  it('handles a mixed feed (cluster + cancellation + one-off)', () => {
    const feed = parseIcs(
      fixture('implicit-mixed.ics'),
      'https://example.com/events.ics',
      'America/Toronto',
      new Date('2026-04-28T00:00:00Z'),
    );
    // Expect: 1 series + 1 one-off
    expect(feed.events).toHaveLength(2);
    const series = feed.events.find(e => e.series);
    const oneOff = feed.events.find(e => !e.series);
    expect(series).toBeDefined();
    expect(oneOff?.summary).toBe('Spring Social');

    expect(series!.summary).toBe('Tuesday Time Trial');  // status suffix stripped
    const cancelled = series!.series?.overrides?.find(o => o.cancelled);
    expect(cancelled?.uid).toBe('cluster-3');
    expect(cancelled?.note).toMatch(/^Cancelled\./);
  });

  it('does not interfere with existing RRULE-based series parsing', () => {
    const feed = parseIcs(
      fixture('series-weekly-tzid.ics'),
      'https://example.com/events.ics',
      'America/Toronto',
    );
    const series = feed.events.find(e => e.series?.kind === 'recurrence');
    expect(series).toBeDefined();
    // Spec: RRULE-based series unchanged; just sanity-check it still appears.
  });
});

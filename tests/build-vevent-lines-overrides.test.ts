import { describe, it, expect } from 'vitest';
import { buildVEventLines } from '../src/lib/ical-helpers';

describe('buildVEventLines — series with extended overrides', () => {
  it('emits per-occurrence URL when override.event_url is set', () => {
    const event = {
      id: 'wed-coffee-2026',
      data: {
        name: 'Wednesday Coffee Ride',
        start_date: '2026-05-06',
        start_time: '10:00',
        series: {
          recurrence: 'weekly',
          recurrence_day: 'wednesday',
          season_start: '2026-05-06',
          season_end: '2026-05-13',
          overrides: [
            { date: '2026-05-06', start_time: '10:00', event_url: 'https://example.com/1' },
            { date: '2026-05-13', start_time: '10:00', event_url: 'https://example.com/2' },
          ],
        },
      },
    };
    const lines = buildVEventLines(event, 'whereto.bike', 'America/Toronto', '20260101T000000Z');
    expect(lines).toHaveLength(2);
    expect(lines[0].lines.some(l => l === 'URL:https://example.com/1')).toBe(true);
    expect(lines[1].lines.some(l => l === 'URL:https://example.com/2')).toBe(true);
  });

  it('skips cancelled occurrences from outbound ICS', () => {
    const event = {
      id: 'wed-coffee-2026',
      data: {
        name: 'Wednesday Coffee Ride',
        start_date: '2026-05-06',
        start_time: '10:00',
        series: {
          recurrence: 'weekly',
          recurrence_day: 'wednesday',
          season_start: '2026-05-06',
          season_end: '2026-05-13',
          overrides: [
            { date: '2026-05-06', start_time: '10:00' },
            { date: '2026-05-13', start_time: '10:00', cancelled: true },
          ],
        },
      },
    };
    const lines = buildVEventLines(event, 'whereto.bike', 'America/Toronto', '20260101T000000Z');
    expect(lines).toHaveLength(1);
    expect(lines[0].uid).toContain('2026-05-06');
  });
});

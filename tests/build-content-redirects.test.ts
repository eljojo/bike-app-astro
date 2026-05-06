import { describe, it, expect } from 'vitest';
import { buildEventPastSlugRedirects } from '../src/build-data-plugin';

describe('buildEventPastSlugRedirects', () => {
  it('maps each past_slug to the canonical event URL within the same year', () => {
    const events = [
      { id: '2026/velo-fridays-women-s-cycling-clinics', past_slugs: ['velo-fridays-women-s-cycling-clinics-2'] },
      { id: '2026/bike-fest', past_slugs: [] },
      { id: '2025/old-event', past_slugs: ['legacy-name', 'older-name'] },
    ];
    const map = buildEventPastSlugRedirects(events);
    expect(map['/events/2026/velo-fridays-women-s-cycling-clinics-2']).toBe('/events/2026/velo-fridays-women-s-cycling-clinics');
    expect(map['/events/2025/legacy-name']).toBe('/events/2025/old-event');
    expect(map['/events/2025/older-name']).toBe('/events/2025/old-event');
    expect(Object.keys(map)).toHaveLength(3);
  });

  it('skips events with no past_slugs', () => {
    const events = [{ id: '2026/x', past_slugs: [] }, { id: '2026/y' }];
    const map = buildEventPastSlugRedirects(events);
    expect(map).toEqual({});
  });
});

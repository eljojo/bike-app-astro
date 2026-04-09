import { describe, it, expect } from 'vitest';

describe('route manifest', () => {
  it('gpxHash produces stable 16-char hex hash', async () => {
    const { gpxHash } = await import('../src/lib/maps/map-generation.server');
    const h1 = gpxHash('<gpx>test</gpx>');
    const h2 = gpxHash('<gpx>test</gpx>');
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[a-f0-9]{16}$/);
  });
});

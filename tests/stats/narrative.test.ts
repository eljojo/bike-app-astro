import { describe, it, expect } from 'vitest';
import { buildNarrative } from '../../src/lib/stats/narrative';

describe('buildNarrative', () => {
  const base = {
    contentType: 'route' as const,
    totalPageviews: 200,
    totalVisitors: 100,
    entryVisitors: 30,
    wallTimeHours: 5,
    avgVisitDuration: 120,
    mapConversionRate: 0.25,
    stars: 3,
    totalReactions: 5,
  };

  it('detects sticky content', () => {
    const result = buildNarrative({ ...base, totalPageviews: 400, totalVisitors: 100 });
    expect(result.some(s => s.includes('come back'))).toBe(true);
  });

  it('detects one-time content', () => {
    const result = buildNarrative({ ...base, totalPageviews: 110, totalVisitors: 100 });
    expect(result.some(s => s.includes('one-time'))).toBe(true);
  });

  it('detects discovery page', () => {
    const result = buildNarrative({ ...base, entryVisitors: 60 });
    expect(result.some(s => s.includes('front door') || s.includes('discovery'))).toBe(true);
  });

  it('detects strong map conversion', () => {
    const result = buildNarrative({ ...base, mapConversionRate: 0.45 });
    expect(result.some(s => s.includes('map') && s.includes('intent'))).toBe(true);
  });

  it('detects weak map conversion', () => {
    const result = buildNarrative({ ...base, totalPageviews: 200, mapConversionRate: 0.02 });
    expect(result.some(s => s.includes('map') && s.includes("don't"))).toBe(true);
  });

  it('detects deep map study behavior', () => {
    const result = buildNarrative({ ...base, mapDurationS: 120, mapConversionRate: 0.25 });
    expect(result.some(s => s.includes('studying the route'))).toBe(true);
  });

  it('returns fallback for no data', () => {
    const result = buildNarrative({ ...base, totalPageviews: 0 });
    expect(result).toEqual(['No analytics data for this period.']);
  });

  it('detects high endorsement rate', () => {
    const result = buildNarrative({ ...base, stars: 10, totalVisitors: 50 });
    expect(result.some(s => s.includes('endorsement'))).toBe(true);
  });
});

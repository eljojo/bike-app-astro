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

  it('reports high views per visitor', () => {
    const result = buildNarrative({ ...base, totalPageviews: 400, totalVisitors: 100 });
    expect(result.some(s => s.includes('4.0 views per visitor'))).toBe(true);
  });

  it('reports low views per visitor', () => {
    const result = buildNarrative({ ...base, totalPageviews: 110, totalVisitors: 100 });
    expect(result.some(s => s.includes('1.1 views per visitor'))).toBe(true);
  });

  it('reports high direct landing rate', () => {
    const result = buildNarrative({ ...base, entryVisitors: 60 });
    expect(result.some(s => s.includes('60%') && s.includes('directly'))).toBe(true);
  });

  it('reports map open rate for routes', () => {
    const result = buildNarrative({ ...base, mapConversionRate: 0.45 });
    expect(result.some(s => s.includes('45%') && s.includes('map'))).toBe(true);
  });

  it('reports map time when significant', () => {
    const result = buildNarrative({ ...base, mapDurationS: 120 });
    expect(result.some(s => s.includes('2 minutes') && s.includes('map'))).toBe(true);
  });

  it('returns fallback for no data', () => {
    const result = buildNarrative({ ...base, totalPageviews: 0 });
    expect(result).toEqual(['No analytics data for this period.']);
  });

  it('reports stars', () => {
    const result = buildNarrative({ ...base, stars: 5 });
    expect(result.some(s => s.includes('5 people'))).toBe(true);
  });

  it('does not interpret visitor intent', () => {
    const result = buildNarrative({ ...base, mapDurationS: 120, mapConversionRate: 0.5, totalPageviews: 500 });
    const allText = result.join(' ');
    // Should not contain interpretive language
    expect(allText).not.toContain('planning');
    expect(allText).not.toContain('intent');
    expect(allText).not.toContain('commit');
    expect(allText).not.toContain('compelling');
    expect(allText).not.toContain('sticky');
    expect(allText).not.toContain('endorsement');
  });
});

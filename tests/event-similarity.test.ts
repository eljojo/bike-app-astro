import { describe, it, expect } from 'vitest';
import { scorePair, findSimilarEvents } from '../src/lib/event-similarity';

describe('scorePair', () => {
  it('scores same organizer highly', () => {
    const a = { id: '2025/ride-a', organizer: 'org1', tags: [], distances: '', linkedRoutes: [] };
    const b = { id: '2025/ride-b', organizer: 'org1', tags: [], distances: '', linkedRoutes: [] };
    expect(scorePair(a, b)).toBe(50);
  });

  it('scores shared tags', () => {
    const a = { id: '2025/ride-a', organizer: 'org1', tags: ['gravel', 'brevet'], distances: '', linkedRoutes: [] };
    const b = { id: '2025/ride-b', organizer: 'org2', tags: ['gravel', 'workshop'], distances: '', linkedRoutes: [] };
    expect(scorePair(a, b)).toBe(15);
  });

  it('scores organizer + tags combined', () => {
    const a = { id: '2025/ride-a', organizer: 'org1', tags: ['gravel'], distances: '', linkedRoutes: [] };
    const b = { id: '2025/ride-b', organizer: 'org1', tags: ['gravel'], distances: '', linkedRoutes: [] };
    expect(scorePair(a, b)).toBe(65);
  });

  it('returns 0 for unrelated events', () => {
    const a = { id: '2025/ride-a', organizer: 'org1', tags: ['gravel'], distances: '', linkedRoutes: [] };
    const b = { id: '2025/ride-b', organizer: 'org2', tags: ['workshop'], distances: '', linkedRoutes: [] };
    expect(scorePair(a, b)).toBe(0);
  });

  it('scores similar distance range', () => {
    const a = { id: '2025/ride-a', organizer: 'org2', tags: [], distances: '100 km', linkedRoutes: [] };
    const b = { id: '2025/ride-b', organizer: 'org1', tags: [], distances: '90 km', linkedRoutes: [] };
    expect(scorePair(a, b)).toBe(10);
  });

  it('does not score distant distance ranges', () => {
    const a = { id: '2025/ride-a', organizer: 'org2', tags: [], distances: '100 km', linkedRoutes: [] };
    const b = { id: '2025/ride-b', organizer: 'org1', tags: [], distances: '50 km', linkedRoutes: [] };
    expect(scorePair(a, b)).toBe(0);
  });

  it('scores shared linked routes', () => {
    const a = { id: '2025/ride-a', organizer: 'org2', tags: [], distances: '', linkedRoutes: ['route-1', 'route-2'] };
    const b = { id: '2025/ride-b', organizer: 'org1', tags: [], distances: '', linkedRoutes: ['route-2', 'route-3'] };
    expect(scorePair(a, b)).toBe(20);
  });

  it('parses max distance from multi-distance string', () => {
    const a = { id: '2025/ride-a', organizer: 'org2', tags: [], distances: '50 km, 100 km, 200 km', linkedRoutes: [] };
    const b = { id: '2025/ride-b', organizer: 'org1', tags: [], distances: '180 km', linkedRoutes: [] };
    expect(scorePair(a, b)).toBe(10);
  });
});

describe('findSimilarEvents', () => {
  it('excludes edition siblings', () => {
    const events = [
      { id: '2025/ride-a', organizer: 'org1', tags: ['gravel'], distances: '', linkedRoutes: [] },
      { id: '2024/ride-a', organizer: 'org1', tags: ['gravel'], distances: '', linkedRoutes: [] },
      { id: '2025/ride-b', organizer: 'org1', tags: ['gravel'], distances: '', linkedRoutes: [] },
    ];
    const editionIds = new Set(['2024/ride-a']);
    const results = findSimilarEvents('2025/ride-a', events, editionIds);
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('2025/ride-b');
  });

  it('returns at most 3 results', () => {
    const events = Array.from({ length: 10 }, (_, i) => ({
      id: `2025/ride-${i}`, organizer: 'org1', tags: ['gravel'], distances: '', linkedRoutes: [],
    }));
    const results = findSimilarEvents('2025/ride-0', events, new Set());
    expect(results.length).toBeLessThanOrEqual(3);
  });
});

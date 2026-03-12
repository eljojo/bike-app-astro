import { describe, it, expect } from 'vitest';
import { computeMigrationPlan, type RideInfo } from '../scripts/migrate-ride-slugs';

describe('computeMigrationPlan', () => {
  it('date-prefixes a clean standalone ride', () => {
    const rides: RideInfo[] = [
      { gpxRelPath: '2025/06/15-perfect-day.gpx', date: { year: 2025, month: 6, day: 15 }, currentSlug: 'perfect-day', isTour: false },
    ];
    const plan = computeMigrationPlan(rides);
    expect(plan).toHaveLength(1);
    expect(plan[0].newSlug).toBe('2025-06-15-perfect-day');
    expect(plan[0].handle).toBe('2025-06-15-perfect-day');
    expect(plan[0].redirects).toContainEqual({ from: 'perfect-day', to: '2025-06-15-perfect-day' });
    // Defensive leading-dash redirect
    expect(plan[0].redirects).toContainEqual({ from: '-perfect-day', to: '2025-06-15-perfect-day' });
  });

  it('strips leading dash and hex hash suffix', () => {
    const rides: RideInfo[] = [
      { gpxRelPath: '2024/03/05-afternoon-ride-ab3a.gpx', date: { year: 2024, month: 3, day: 5 }, currentSlug: '-afternoon-ride-ab3a', isTour: false },
    ];
    const plan = computeMigrationPlan(rides);
    expect(plan[0].newSlug).toBe('2024-03-05-afternoon-ride');
    expect(plan[0].redirects).toContainEqual({ from: '-afternoon-ride-ab3a', to: '2024-03-05-afternoon-ride' });
    // Also redirect the without-leading-dash form
    expect(plan[0].redirects).toContainEqual({ from: 'afternoon-ride-ab3a', to: '2024-03-05-afternoon-ride' });
    // And the old auto-generated date-prefixed form
    expect(plan[0].redirects).toContainEqual({ from: '2024-03-05-afternoon-ride-ab3a', to: '2024-03-05-afternoon-ride' });
  });

  it('preserves pure-digit suffix (not stripped by cleanSlugName)', () => {
    const rides: RideInfo[] = [
      { gpxRelPath: '2024/03/05-afternoon-ride-6136.gpx', date: { year: 2024, month: 3, day: 5 }, currentSlug: 'afternoon-ride-6136', isTour: false },
    ];
    const plan = computeMigrationPlan(rides);
    // cleanSlugName doesn't strip pure-digit suffixes, so slug keeps the suffix
    expect(plan[0].newSlug).toBe('2024-03-05-afternoon-ride-6136');
    // Only redirect from the old name-only slug
    expect(plan[0].redirects).toContainEqual({ from: 'afternoon-ride-6136', to: '2024-03-05-afternoon-ride-6136' });
  });

  it('strips Strava numeric prefix', () => {
    const rides: RideInfo[] = [
      { gpxRelPath: '2020/06/09-302-evening-ride.gpx', date: { year: 2020, month: 6, day: 9 }, currentSlug: '302-evening-ride', isTour: false },
    ];
    const plan = computeMigrationPlan(rides);
    expect(plan[0].newSlug).toBe('2020-06-09-evening-ride');
    expect(plan[0].redirects).toContainEqual({ from: '302-evening-ride', to: '2020-06-09-evening-ride' });
    expect(plan[0].redirects).toContainEqual({ from: '2020-06-09-302-evening-ride', to: '2020-06-09-evening-ride' });
  });

  it('skips tour rides', () => {
    const rides: RideInfo[] = [
      { gpxRelPath: '2025/09/euro-trip/09-amsterdam.gpx', date: { year: 2025, month: 9, day: 9 }, currentSlug: 'amsterdam', isTour: true },
    ];
    const plan = computeMigrationPlan(rides);
    expect(plan).toHaveLength(0);
  });

  it('handles same-date collision by keeping suffix on second ride', () => {
    const rides: RideInfo[] = [
      { gpxRelPath: '2024/03/05-afternoon-ride-ab3a.gpx', date: { year: 2024, month: 3, day: 5 }, currentSlug: 'afternoon-ride-ab3a', isTour: false },
      { gpxRelPath: '2024/03/05-afternoon-ride-b890.gpx', date: { year: 2024, month: 3, day: 5 }, currentSlug: 'afternoon-ride-b890', isTour: false },
    ];
    const plan = computeMigrationPlan(rides);
    const slugs = plan.map(p => p.newSlug);
    expect(slugs).toContain('2024-03-05-afternoon-ride');
    // Second one keeps suffix to avoid collision
    expect(slugs).toContain('2024-03-05-afternoon-ride-b890');
  });

  it('still adds leading-dash redirect when old slug equals new slug', () => {
    // A ride that already has the right slug (hypothetical)
    const rides: RideInfo[] = [
      { gpxRelPath: '2025/06/15-perfect-day.gpx', date: { year: 2025, month: 6, day: 15 }, currentSlug: '2025-06-15-perfect-day', isTour: false },
    ];
    const plan = computeMigrationPlan(rides);
    expect(plan[0].handle).toBe('2025-06-15-perfect-day');
    // Only the defensive leading-dash redirect
    expect(plan[0].redirects).toEqual([
      { from: '-2025-06-15-perfect-day', to: '2025-06-15-perfect-day' },
    ]);
  });

  it('handles ride with leading dash slug (double-dash GPX filename)', () => {
    const rides: RideInfo[] = [
      { gpxRelPath: '2025/10/20--wandering-c812.gpx', date: { year: 2025, month: 10, day: 20 }, currentSlug: '-wandering-c812', isTour: false },
    ];
    const plan = computeMigrationPlan(rides);
    expect(plan[0].newSlug).toBe('2025-10-20-wandering');
    expect(plan[0].redirects).toContainEqual({ from: '-wandering-c812', to: '2025-10-20-wandering' });
  });
});

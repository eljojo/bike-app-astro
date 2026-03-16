import { describe, it, expect } from 'vitest';
import { routeOps, eventOps, placeOps } from '../src/lib/content/content-ops';

describe('routeOps.getFilePaths', () => {
  it('returns primary index.md and auxiliary media.yml + translations', () => {
    const paths = routeOps.getFilePaths('pink-aylmer');
    expect(paths.primary).toMatch(/routes\/pink-aylmer\/index\.md$/);
    expect(paths.auxiliary).toBeDefined();
    expect(paths.auxiliary!.some(p => p.endsWith('/media.yml'))).toBe(true);
  });
});

describe('eventOps.getFilePaths', () => {
  it('returns directory-based paths for event', () => {
    const paths = eventOps.getFilePaths('2026/bike-fest');
    expect(paths.primary).toMatch(/events\/2026\/bike-fest\/index\.md$/);
    expect(paths.auxiliary).toBeDefined();
    expect(paths.auxiliary!.some(p => p.endsWith('.md'))).toBe(true);
    expect(paths.auxiliary!.some(p => p.endsWith('/media.yml'))).toBe(true);
  });
});

describe('placeOps.getFilePaths', () => {
  it('returns single primary .md path', () => {
    const paths = placeOps.getFilePaths('good-cafe');
    expect(paths.primary).toMatch(/places\/good-cafe\.md$/);
    expect(paths.auxiliary).toBeUndefined();
  });
});

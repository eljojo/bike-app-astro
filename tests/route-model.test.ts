import { describe, it, expect } from 'vitest';
import { routeDetailFromGit, routeDetailToCache, routeDetailFromCache, computeRouteContentHash } from '../src/lib/models/route-model';

describe('routeDetailFromGit', () => {
  it('parses frontmatter, body, and photo-only media into canonical shape', () => {
    const frontmatter = {
      name: 'Test Route',
      tagline: 'A test',
      tags: ['scenic'],
      status: 'published',
      distance_km: 12.5,
      variants: [{ name: 'Main', gpx: 'main.gpx', distance_km: 12.5 }],
    };
    const body = '\nRoute description here.\n';
    const mediaYml = `- type: photo\n  key: abc123\n  caption: Nice view\n  cover: true\n  score: 5\n  width: 1600\n  height: 1200\n- type: video\n  key: vid456\n  title: Ride Along\n  duration: "5:30"\n`;

    const result = routeDetailFromGit('test-route', frontmatter, body, mediaYml);

    expect(result.slug).toBe('test-route');
    expect(result.name).toBe('Test Route');
    expect(result.tagline).toBe('A test');
    expect(result.tags).toEqual(['scenic']);
    expect(result.status).toBe('published');
    expect(result.body).toBe('Route description here.');
    expect(result.media).toHaveLength(1); // videos filtered out
    expect(result.media[0]).toEqual({ key: 'abc123', caption: 'Nice view', cover: true });
    expect(result.variants).toEqual([{ name: 'Main', gpx: 'main.gpx', distance_km: 12.5 }]);
  });

  it('handles missing optional fields', () => {
    const result = routeDetailFromGit('minimal', { name: 'Min', status: 'draft' }, '', '');
    expect(result.tagline).toBe('');
    expect(result.tags).toEqual([]);
    expect(result.media).toEqual([]);
    expect(result.variants).toEqual([]);
    expect(result.body).toBe('');
  });

  it('handles null/undefined mediaYml', () => {
    const result = routeDetailFromGit('no-media', { name: 'X', status: 'draft' }, '', undefined as any);
    expect(result.media).toEqual([]);
  });
});

describe('routeDetailToCache / routeDetailFromCache', () => {
  it('round-trips correctly', () => {
    const detail = routeDetailFromGit(
      'test',
      { name: 'Test', tagline: 'Hi', tags: ['a'], status: 'published', distance_km: 5, variants: [] },
      'body text',
      '- type: photo\n  key: k1\n  caption: cap\n',
    );
    const cached = routeDetailToCache(detail);
    const parsed = routeDetailFromCache(cached);
    expect(parsed).toEqual(detail);
  });

  it('fromCache throws on invalid JSON', () => {
    expect(() => routeDetailFromCache('not json')).toThrow();
  });

  it('fromCache throws on missing required fields', () => {
    expect(() => routeDetailFromCache(JSON.stringify({ slug: 'x' }))).toThrow();
  });
});

describe('computeRouteContentHash', () => {
  it('hashes primary content', () => {
    const hash = computeRouteContentHash('# Hello', undefined);
    expect(typeof hash).toBe('string');
    expect(hash).toHaveLength(32); // MD5 hex
  });

  it('includes media content when present', () => {
    const hashWithout = computeRouteContentHash('# Hello', undefined);
    const hashWith = computeRouteContentHash('# Hello', '- key: abc');
    expect(hashWithout).not.toBe(hashWith);
  });

  it('same input produces same hash', () => {
    const a = computeRouteContentHash('body', 'media');
    const b = computeRouteContentHash('body', 'media');
    expect(a).toBe(b);
  });
});

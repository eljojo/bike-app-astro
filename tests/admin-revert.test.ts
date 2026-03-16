import { describe, it, expect } from 'vitest';
import { routeDetailFromGit, routeDetailToCache } from '../src/lib/models/route-model';

describe('revert cache serialization (via route model)', () => {
  it('includes all media types when building cache for routes', () => {
    const frontmatter = { name: 'Test', status: 'published', distance_km: 10 };
    const body = 'description';
    const mediaYml = [
      '- type: photo',
      '  key: photo1',
      '  caption: Nice',
      '- type: video',
      '  key: vid1',
      '  title: Ride',
      '  duration: "3:00"',
    ].join('\n');

    const detail = routeDetailFromGit('test-route', frontmatter, body, mediaYml);
    const cached = routeDetailToCache(detail);
    const parsed = JSON.parse(cached);

    expect(parsed.media).toHaveLength(2);
    expect(parsed.media[0].key).toBe('photo1');
    expect(parsed.media[1].key).toBe('vid1');
    expect(parsed.media[1].type).toBe('video');
    expect(parsed.media[1].title).toBe('Ride');
  });
});

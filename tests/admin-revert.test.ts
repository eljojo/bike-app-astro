import { describe, it, expect } from 'vitest';
import { routeDetailFromGit, routeDetailToCache } from '../src/lib/models/route-model';

describe('revert cache serialization (via route model)', () => {
  it('filters videos from media when building cache for routes', () => {
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

    expect(parsed.media).toHaveLength(1);
    expect(parsed.media[0].key).toBe('photo1');
    // Video should NOT be in cached media
    expect(parsed.media.find((m: any) => m.key === 'vid1')).toBeUndefined();
  });
});

import { describe, it, expect } from 'vitest';
import yaml from 'js-yaml';
import { routeDetailFromGit } from '../../src/lib/models/route-model';

describe('routeDetailFromGit', () => {
  it('maps width and height from media.yml', () => {
    const detail = routeDetailFromGit(
      'test',
      { name: 'Test', variants: [] },
      'body',
      yaml.dump([{ type: 'photo', key: 'abc', width: 1600, height: 1200 }]),
    );
    expect(detail.media[0].width).toBe(1600);
    expect(detail.media[0].height).toBe(1200);
  });
});

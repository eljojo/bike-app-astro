import { describe, it, expect } from 'vitest';
import { mapImageUrl } from '../src/lib/maps/map-image-url';

describe('mapImageUrl', () => {
  it('builds bike path URL', () => {
    const url = mapImageUrl('bike-path', 'aviation-pathway', 'social', {
      hash: '424ac567b00f', lang: 'en',
    });
    expect(url).toBe('/api/map-image/bike-path/424ac567b00f/aviation-pathway-social-en.png');
  });

  it('builds route URL with variant', () => {
    const url = mapImageUrl('route', 'aylmer', 'thumb-2x', {
      hash: 'a1b2c3d4e5f6', variant: 'main', lang: 'en',
    });
    expect(url).toBe('/api/map-image/route/a1b2c3d4e5f6/aylmer--main-thumb-2x-en.png');
  });

  it('builds tour URL', () => {
    const url = mapImageUrl('tour', 'patagonia', 'thumb', {
      hash: '87c845e8d9aa', lang: 'fr',
    });
    expect(url).toBe('/api/map-image/tour/87c845e8d9aa/patagonia-thumb-fr.png');
  });

  it('builds srcset', () => {
    const srcset = [
      `${mapImageUrl('route', 'aylmer', 'thumb', { hash: 'abc123def456', lang: 'en' })} 1x`,
      `${mapImageUrl('route', 'aylmer', 'thumb-2x', { hash: 'abc123def456', lang: 'en' })} 2x`,
    ].join(', ');
    expect(srcset).toContain('thumb-en.png 1x');
    expect(srcset).toContain('thumb-2x-en.png 2x');
  });
});

import { describe, it, expect } from 'vitest';
import { buildThunderforestUrl, contentTypeForPath } from '../../src/lib/maps/tile-proxy-helpers';

describe('tile proxy helpers', () => {
  it('builds Thunderforest URL with API key', () => {
    const url = buildThunderforestUrl(
      'tiles/thunderforest.outdoors-v2/14/4662/2983.pbf',
      'test-key'
    );
    expect(url).toBe(
      'https://api.thunderforest.com/tiles/thunderforest.outdoors-v2/14/4662/2983.pbf?apikey=test-key'
    );
  });

  it('detects content type for PBF tiles', () => {
    expect(contentTypeForPath('tiles/outdoors/14/4662/2983.pbf'))
      .toBe('application/x-protobuf');
  });

  it('detects content type for JSON', () => {
    expect(contentTypeForPath('thunderforest.outdoors-v2.json'))
      .toBe('application/json');
  });

  it('detects content type for PNG sprites', () => {
    expect(contentTypeForPath('sprites/atlas.png'))
      .toBe('image/png');
  });

  it('detects content type for font glyphs', () => {
    expect(contentTypeForPath('fonts/Roboto/0-255.pbf'))
      .toBe('application/x-protobuf');
  });
});

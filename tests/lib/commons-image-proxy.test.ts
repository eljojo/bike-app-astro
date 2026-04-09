import { describe, it, expect } from 'vitest';
import { buildCommonsUrl, commonsContentType } from '../../src/views/api/commons-image-helpers';

describe('buildCommonsUrl', () => {
  it('constructs Special:FilePath URL from filename', () => {
    expect(buildCommonsUrl('Ottawa Sept 09 2006 068.jpg'))
      .toBe('https://commons.wikimedia.org/wiki/Special:FilePath/Ottawa%20Sept%2009%202006%20068.jpg');
  });
});

describe('commonsContentType', () => {
  it('returns image/jpeg for .jpg', () => {
    expect(commonsContentType('photo.jpg')).toBe('image/jpeg');
  });
  it('returns image/png for .png', () => {
    expect(commonsContentType('diagram.png')).toBe('image/png');
  });
  it('returns image/jpeg as fallback', () => {
    expect(commonsContentType('unknown')).toBe('image/jpeg');
  });
});

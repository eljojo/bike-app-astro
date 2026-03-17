import { describe, it, expect } from 'vitest';
import { h264OutputKey, posterKeyForVideo } from '../src/lib/media/video-completion';
import { VIDEO_PREFIX } from '../src/lib/config/config';

describe('video-completion helpers', () => {
  describe('h264OutputKey', () => {
    it('returns city-prefixed key/key-h264.mp4 path', () => {
      expect(h264OutputKey('abc12345')).toBe(`${VIDEO_PREFIX}/abc12345/abc12345-h264.mp4`);
    });
  });

  describe('posterKeyForVideo', () => {
    it('returns city-prefixed poster frame path', () => {
      expect(posterKeyForVideo('abc12345')).toBe(`${VIDEO_PREFIX}/abc12345/abc12345-poster.0000000.jpg`);
    });
  });
});

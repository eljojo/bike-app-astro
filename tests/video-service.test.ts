import { describe, it, expect } from 'vitest';
import { videoPlaybackSources, videoPosterUrl, videoDisplaySize } from '../src/lib/media/video-service';
import { CITY } from '../src/lib/config/config';

describe('videoPlaybackSources', () => {
  it('returns AV1 and H264 sources with city prefix', () => {
    const sources = videoPlaybackSources('abc123');
    expect(sources).toHaveLength(2);
    expect(sources[0].type).toContain('av01');
    expect(sources[0].src).toContain(`/${CITY}/abc123/abc123-av1.mp4`);
    expect(sources[1].type).toContain('avc1');
    expect(sources[1].src).toContain(`/${CITY}/abc123/abc123-h264.mp4`);
  });
});

describe('videoPosterUrl', () => {
  it('derives poster URL from video key with city prefix', () => {
    const url = videoPosterUrl('abc123');
    expect(url).toContain(`/${CITY}/abc123/abc123-poster.0000000.jpg`);
  });

  it('uses videos CDN, not image CDN transforms', () => {
    const url = videoPosterUrl('abc123');
    expect(url).not.toContain('cdn-cgi/image');
  });
});

describe('videoDisplaySize', () => {
  it('scales portrait videos to reasonable display size', () => {
    const { width, height } = videoDisplaySize(2160, 3840);
    expect(width).toBeLessThan(500);
    expect(height).toBeGreaterThan(width);
  });

  it('scales landscape videos to reasonable display size', () => {
    const { width, height } = videoDisplaySize(1920, 1080);
    expect(width).toBeLessThanOrEqual(640);
    expect(height).toBeLessThan(width);
  });
});

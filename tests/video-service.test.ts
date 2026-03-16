import { describe, it, expect } from 'vitest';
import { videoPlaybackSources, videoPosterUrl, videoDisplaySize } from '../src/lib/media/video-service';
import { VIDEO_PREFIX } from '../src/lib/config/config';

describe('videoPlaybackSources', () => {
  it('returns HLS and H.264 sources', () => {
    const sources = videoPlaybackSources('abc123');
    expect(sources).toHaveLength(2);
    expect(sources[0].type).toBe('application/vnd.apple.mpegurl');
    expect(sources[0].src).toContain(`/${VIDEO_PREFIX}/abc123/abc123.m3u8`);
    expect(sources[1].type).toBe('video/mp4');
    expect(sources[1].src).toContain(`/${VIDEO_PREFIX}/abc123/abc123-h264.mp4`);
  });
});

describe('videoPosterUrl', () => {
  it('derives poster URL from video key with city prefix', () => {
    const url = videoPosterUrl('abc123');
    expect(url).toContain(`/${VIDEO_PREFIX}/abc123/abc123-poster.0000000.jpg`);
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

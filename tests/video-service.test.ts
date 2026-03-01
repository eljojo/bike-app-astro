import { describe, it, expect } from 'vitest';
import { videoPlaybackSources, videoPosterUrl, videoDisplaySize } from '../src/lib/video-service';

describe('videoPlaybackSources', () => {
  it('returns HLS, AV1, and H264 sources', () => {
    const sources = videoPlaybackSources('abc123');
    expect(sources).toHaveLength(3);
    expect(sources[0].type).toBe('application/x-mpegURL');
    expect(sources[0].src).toContain('abc123/abc123.m3u8');
    expect(sources[1].type).toContain('av01');
    expect(sources[2].type).toContain('avc1');
  });
});

describe('videoPosterUrl', () => {
  it('generates poster URL from poster_key', () => {
    const url = videoPosterUrl('posterKey123');
    expect(url).toContain('posterKey123');
    expect(url).toContain('width=600');
  });

  it('does not crop poster (width-only resize)', () => {
    const url = videoPosterUrl('posterKey123');
    expect(url).not.toContain('fit=');
    expect(url).not.toContain('height=');
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

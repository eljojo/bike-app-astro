import { describe, it, expect } from 'vitest';
import {
  videoPlaybackSources,
  videoPosterUrl,
  videoDisplaySize,
  videoFallbackUrl,
  resolveVideoPath,
  bareVideoKey,
  videoKeyForGit,
} from '../src/lib/media/video-service';
import { CITY } from '../src/lib/config/config';

describe('bareVideoKey', () => {
  it('returns key unchanged when no prefix', () => {
    expect(bareVideoKey('abc12345')).toBe('abc12345');
  });
  it('strips prefix from annotated key', () => {
    expect(bareVideoKey('ottawa-staging/abc12345')).toBe('abc12345');
  });
  it('is idempotent', () => {
    expect(bareVideoKey(bareVideoKey('ottawa-staging/abc12345'))).toBe('abc12345');
  });
});

describe('resolveVideoPath', () => {
  it('returns embedded prefix when key contains /', () => {
    expect(resolveVideoPath('ottawa-staging/abc12345')).toEqual({
      prefix: 'ottawa-staging',
      bareKey: 'abc12345',
    });
  });
  it('returns CITY as prefix for plain keys on wiki/club', () => {
    const result = resolveVideoPath('abc12345');
    expect(result.prefix).toBe(CITY);
    expect(result.bareKey).toBe('abc12345');
  });
  it('resolves annotated key to correct playback URL parts', () => {
    const { prefix, bareKey } = resolveVideoPath('ottawa-staging/k3eovg6o');
    expect(prefix).toBe('ottawa-staging');
    expect(bareKey).toBe('k3eovg6o');
  });
});

describe('videoKeyForGit', () => {
  it('returns plain key when VIDEO_PREFIX matches CITY', () => {
    expect(videoKeyForGit('abc12345')).toBe('abc12345');
  });
  it('is idempotent — strips existing prefix before re-annotating', () => {
    expect(videoKeyForGit('some-prefix/abc12345')).toBe('abc12345');
  });
  it('round-trips with resolveVideoPath', () => {
    const gitKey = videoKeyForGit('abc12345');
    const { bareKey } = resolveVideoPath(gitKey);
    expect(bareKey).toBe('abc12345');
  });
  it('round-trips annotated keys with resolveVideoPath', () => {
    const annotated = 'ottawa-staging/abc12345';
    const { prefix, bareKey } = resolveVideoPath(annotated);
    expect(prefix).toBe('ottawa-staging');
    expect(bareKey).toBe('abc12345');
    expect(bareVideoKey(annotated)).toBe('abc12345');
  });
});

describe('videoPlaybackSources', () => {
  it('returns HLS and H.264 sources', () => {
    const sources = videoPlaybackSources('abc123');
    expect(sources).toHaveLength(2);
    expect(sources[0].type).toBe('application/vnd.apple.mpegurl');
    expect(sources[0].src).toContain(`/${CITY}/abc123/abc123.m3u8`);
    expect(sources[1].type).toBe('video/mp4');
    expect(sources[1].src).toContain(`/${CITY}/abc123/abc123-h264.mp4`);
  });
  it('uses embedded prefix for annotated keys', () => {
    const sources = videoPlaybackSources('ottawa-staging/abc12345');
    expect(sources[0].src).toContain('/ottawa-staging/abc12345/abc12345.m3u8');
    expect(sources[1].src).toContain('/ottawa-staging/abc12345/abc12345-h264.mp4');
  });
  it('uses CITY prefix for plain keys', () => {
    const sources = videoPlaybackSources('abc12345');
    expect(sources[0].src).toContain(`/${CITY}/abc12345/abc12345.m3u8`);
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
  it('uses embedded prefix for annotated keys', () => {
    const url = videoPosterUrl('ottawa-staging/abc12345');
    expect(url).toContain('/ottawa-staging/abc12345/abc12345-poster.0000000.jpg');
  });
});

describe('videoFallbackUrl', () => {
  it('returns H.264 MP4 URL with CITY prefix for plain keys', () => {
    const url = videoFallbackUrl('abc123');
    expect(url).toContain(`/${CITY}/abc123/abc123-h264.mp4`);
  });
  it('uses embedded prefix for annotated keys', () => {
    const url = videoFallbackUrl('ottawa-staging/abc12345');
    expect(url).toContain('/ottawa-staging/abc12345/abc12345-h264.mp4');
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

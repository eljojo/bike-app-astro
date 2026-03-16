/**
 * VIDEO READ PATH — Rendering video from resources.
 *
 * Assumes the video key has been properly persisted to media.yml
 * (tested in video-add.test.ts). Tests that all URL generation produces
 * correct CDN paths for playback, posters, fallbacks, and admin thumbnails.
 *
 * For each of three deployment scenarios:
 *   1. Production wiki (CITY=montreal, VIDEO_PREFIX=montreal)
 *   2. Staging wiki   (CITY=montreal, VIDEO_PREFIX=montreal-staging)
 *   3. Blog           (CITY=blog,     VIDEO_PREFIX=eljojo_bike-blog)
 *
 * The key forms stored in media.yml (what the renderer receives):
 *   - Production wiki: bare "abcdef" (CITY prefix was stripped on save)
 *   - Staging wiki: "montreal-staging/abcdef" (prefix preserved, not derivable)
 *   - Blog: bare "abcdef" (VIDEO_PREFIX stripped on save)
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';

const CDN = 'https://videos.example.com';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Scenario 1: Production wiki — CITY=montreal, VIDEO_PREFIX=montreal
// Key in media.yml: bare "abcdef"
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
describe('Scenario 1: production wiki (CITY=montreal, VIDEO_PREFIX=montreal)', () => {
  beforeAll(() => {
    vi.doMock('../src/lib/config/config', () => ({
      // eslint-disable-next-line bike-app/no-hardcoded-city-locale -- test mock
      CITY: 'montreal',
      // eslint-disable-next-line bike-app/no-hardcoded-city-locale -- test mock
      VIDEO_PREFIX: 'montreal',
    }));
    vi.doMock('../src/lib/config/city-config', () => ({
      getCityConfig: () => ({ videos_cdn_url: CDN }),
      isBlogInstance: () => false,
    }));
  });
  beforeEach(() => vi.resetModules());
  afterAll(() => {
    vi.doUnmock('../src/lib/config/config');
    vi.doUnmock('../src/lib/config/city-config');
  });

  // The key as stored in media.yml after save pipeline
  const gitKey = 'abcdef';

  // ── Path resolution ────────────────────────────────────────────────────
  it('resolveVideoPath: bare key → CITY prefix', async () => {
    const { resolveVideoPath } = await import('../src/lib/media/video-service');
    expect(resolveVideoPath(gitKey)).toEqual({ prefix: 'montreal', bareKey: 'abcdef' });
  });

  // ── HLS + H.264 playback ──────────────────────────────────────────────
  it('videoPlaybackSources: correct HLS and MP4 URLs', async () => {
    const { videoPlaybackSources } = await import('../src/lib/media/video-service');
    const sources = videoPlaybackSources(gitKey);
    expect(sources).toHaveLength(2);
    expect(sources[0]).toEqual({
      src: `${CDN}/montreal/abcdef/abcdef.m3u8`,
      type: 'application/vnd.apple.mpegurl',
    });
    expect(sources[1]).toEqual({
      src: `${CDN}/montreal/abcdef/abcdef-h264.mp4`,
      type: 'video/mp4',
    });
  });

  // ── Poster frame ───────────────────────────────────────────────────────
  it('videoPosterUrl: correct poster URL', async () => {
    const { videoPosterUrl } = await import('../src/lib/media/video-service');
    expect(videoPosterUrl(gitKey)).toBe(`${CDN}/montreal/abcdef/abcdef-poster.0000000.jpg`);
  });

  // ── Fallback download ─────────────────────────────────────────────────
  it('videoFallbackUrl: correct H.264 URL', async () => {
    const { videoFallbackUrl } = await import('../src/lib/media/video-service');
    expect(videoFallbackUrl(gitKey)).toBe(`${CDN}/montreal/abcdef/abcdef-h264.mp4`);
  });

  // ── Client-side admin poster (buildVideoPosterUrl) ─────────────────────
  it('buildVideoPosterUrl with videoPrefix fallback', async () => {
    const { buildVideoPosterUrl } = await import('../src/lib/media/video-urls');
    // Admin passes CITY as videoPrefix for bare keys
    expect(buildVideoPosterUrl(CDN, gitKey, 'montreal'))
      .toBe(`${CDN}/montreal/abcdef/abcdef-poster.0000000.jpg`);
  });

  // ── Also renders staging-prefixed keys correctly ───────────────────────
  it('staging-prefixed key in media.yml renders with embedded prefix', async () => {
    const { videoPlaybackSources, videoPosterUrl } = await import('../src/lib/media/video-service');
    const stagingKey = 'montreal-staging/xyz789';
    const sources = videoPlaybackSources(stagingKey);
    expect(sources[0].src).toBe(`${CDN}/montreal-staging/xyz789/xyz789.m3u8`);
    expect(videoPosterUrl(stagingKey)).toBe(`${CDN}/montreal-staging/xyz789/xyz789-poster.0000000.jpg`);
  });

  // ── Self-healing: video-status uses h264OutputKey with bare key ────────
  it('h264OutputKey for self-healing CDN check', async () => {
    const { h264OutputKey } = await import('../src/lib/media/video-completion');
    // video-status.ts calls h264OutputKey(bareKey) — DB stores bare keys
    expect(h264OutputKey('abcdef')).toBe('montreal/abcdef/abcdef-h264.mp4');
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Scenario 2: Staging wiki — CITY=montreal, VIDEO_PREFIX=montreal-staging
// Key in media.yml: "montreal-staging/abcdef" (prefix preserved)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
describe('Scenario 2: staging wiki (CITY=montreal, VIDEO_PREFIX=montreal-staging)', () => {
  beforeAll(() => {
    vi.doMock('../src/lib/config/config', () => ({
      // eslint-disable-next-line bike-app/no-hardcoded-city-locale -- test mock
      CITY: 'montreal',
      // eslint-disable-next-line bike-app/no-hardcoded-city-locale -- test mock
      VIDEO_PREFIX: 'montreal-staging',
    }));
    vi.doMock('../src/lib/config/city-config', () => ({
      getCityConfig: () => ({ videos_cdn_url: CDN }),
      isBlogInstance: () => false,
    }));
  });
  beforeEach(() => vi.resetModules());
  afterAll(() => {
    vi.doUnmock('../src/lib/config/config');
    vi.doUnmock('../src/lib/config/city-config');
  });

  // Staging video — the key as stored in media.yml
  const gitKey = 'montreal-staging/abcdef';

  // ── Path resolution ────────────────────────────────────────────────────
  it('resolveVideoPath: prefixed key → embedded prefix', async () => {
    const { resolveVideoPath } = await import('../src/lib/media/video-service');
    expect(resolveVideoPath(gitKey)).toEqual({ prefix: 'montreal-staging', bareKey: 'abcdef' });
  });

  // ── HLS + H.264 playback ──────────────────────────────────────────────
  it('videoPlaybackSources: staging prefix in all URLs', async () => {
    const { videoPlaybackSources } = await import('../src/lib/media/video-service');
    const sources = videoPlaybackSources(gitKey);
    expect(sources[0]).toEqual({
      src: `${CDN}/montreal-staging/abcdef/abcdef.m3u8`,
      type: 'application/vnd.apple.mpegurl',
    });
    expect(sources[1]).toEqual({
      src: `${CDN}/montreal-staging/abcdef/abcdef-h264.mp4`,
      type: 'video/mp4',
    });
  });

  // ── Poster frame ───────────────────────────────────────────────────────
  it('videoPosterUrl: staging prefix', async () => {
    const { videoPosterUrl } = await import('../src/lib/media/video-service');
    expect(videoPosterUrl(gitKey)).toBe(`${CDN}/montreal-staging/abcdef/abcdef-poster.0000000.jpg`);
  });

  // ── Fallback ───────────────────────────────────────────────────────────
  it('videoFallbackUrl: staging prefix', async () => {
    const { videoFallbackUrl } = await import('../src/lib/media/video-service');
    expect(videoFallbackUrl(gitKey)).toBe(`${CDN}/montreal-staging/abcdef/abcdef-h264.mp4`);
  });

  // ── Client-side admin poster ───────────────────────────────────────────
  it('buildVideoPosterUrl: extracts prefix from key (ignores videoPrefix fallback)', async () => {
    const { buildVideoPosterUrl } = await import('../src/lib/media/video-urls');
    // When key has embedded prefix, the defaultPrefix arg doesn't matter
    expect(buildVideoPosterUrl(CDN, gitKey, 'montreal'))
      .toBe(`${CDN}/montreal-staging/abcdef/abcdef-poster.0000000.jpg`);
  });

  // ── Production bare keys still work on staging (they point to prod R2) ─
  it('bare key resolves to CITY prefix (production video on staging)', async () => {
    const { videoPlaybackSources } = await import('../src/lib/media/video-service');
    const sources = videoPlaybackSources('prodvid1');
    expect(sources[0].src).toBe(`${CDN}/montreal/prodvid1/prodvid1.m3u8`);
  });

  // ── Self-healing ───────────────────────────────────────────────────────
  it('h264OutputKey uses VIDEO_PREFIX for staging', async () => {
    const { h264OutputKey } = await import('../src/lib/media/video-completion');
    expect(h264OutputKey('abcdef')).toBe('montreal-staging/abcdef/abcdef-h264.mp4');
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Scenario 3: Blog — CITY=blog, VIDEO_PREFIX=eljojo_bike-blog
// Key in media.yml: bare "abcdef" (prefix stripped on save)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
describe('Scenario 3: blog (CITY=blog, VIDEO_PREFIX=eljojo_bike-blog)', () => {
  beforeAll(() => {
    vi.doMock('../src/lib/config/config', () => ({
      // eslint-disable-next-line bike-app/no-hardcoded-city-locale -- test mock
      CITY: 'blog',
      // eslint-disable-next-line bike-app/no-hardcoded-city-locale -- test mock
      VIDEO_PREFIX: 'eljojo_bike-blog',
    }));
    vi.doMock('../src/lib/config/city-config', () => ({
      getCityConfig: () => ({ videos_cdn_url: CDN }),
      isBlogInstance: () => true,
    }));
  });
  beforeEach(() => vi.resetModules());
  afterAll(() => {
    vi.doUnmock('../src/lib/config/config');
    vi.doUnmock('../src/lib/config/city-config');
  });

  // Blog video — the key as stored in media.yml
  const gitKey = 'abcdef';

  // ── Path resolution ────────────────────────────────────────────────────
  it('resolveVideoPath: bare key → VIDEO_PREFIX for blog', async () => {
    const { resolveVideoPath } = await import('../src/lib/media/video-service');
    // Blog uses VIDEO_PREFIX (not CITY) to resolve bare keys
    expect(resolveVideoPath(gitKey)).toEqual({ prefix: 'eljojo_bike-blog', bareKey: 'abcdef' });
  });

  // ── HLS + H.264 playback ──────────────────────────────────────────────
  it('videoPlaybackSources: VIDEO_PREFIX in URLs', async () => {
    const { videoPlaybackSources } = await import('../src/lib/media/video-service');
    const sources = videoPlaybackSources(gitKey);
    expect(sources[0]).toEqual({
      src: `${CDN}/eljojo_bike-blog/abcdef/abcdef.m3u8`,
      type: 'application/vnd.apple.mpegurl',
    });
    expect(sources[1]).toEqual({
      src: `${CDN}/eljojo_bike-blog/abcdef/abcdef-h264.mp4`,
      type: 'video/mp4',
    });
  });

  // ── Poster frame ───────────────────────────────────────────────────────
  it('videoPosterUrl: VIDEO_PREFIX in poster URL', async () => {
    const { videoPosterUrl } = await import('../src/lib/media/video-service');
    expect(videoPosterUrl(gitKey)).toBe(`${CDN}/eljojo_bike-blog/abcdef/abcdef-poster.0000000.jpg`);
  });

  // ── Fallback ───────────────────────────────────────────────────────────
  it('videoFallbackUrl: VIDEO_PREFIX in fallback URL', async () => {
    const { videoFallbackUrl } = await import('../src/lib/media/video-service');
    expect(videoFallbackUrl(gitKey)).toBe(`${CDN}/eljojo_bike-blog/abcdef/abcdef-h264.mp4`);
  });

  // ── Client-side admin poster ───────────────────────────────────────────
  it('buildVideoPosterUrl with blog VIDEO_PREFIX as fallback', async () => {
    const { buildVideoPosterUrl } = await import('../src/lib/media/video-urls');
    // Admin passes VIDEO_PREFIX as videoPrefix for blog instances
    expect(buildVideoPosterUrl(CDN, gitKey, 'eljojo_bike-blog'))
      .toBe(`${CDN}/eljojo_bike-blog/abcdef/abcdef-poster.0000000.jpg`);
  });

  // ── Self-healing ───────────────────────────────────────────────────────
  it('h264OutputKey uses blog VIDEO_PREFIX', async () => {
    const { h264OutputKey } = await import('../src/lib/media/video-completion');
    expect(h264OutputKey('abcdef')).toBe('eljojo_bike-blog/abcdef/abcdef-h264.mp4');
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Cross-cutting: bareVideoKey is the universal key extractor
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
describe('bareVideoKey (shared by enrichment, status lookup, and webhook)', () => {
  beforeAll(() => {
    vi.doMock('../src/lib/config/config', () => ({
      CITY: 'x', VIDEO_PREFIX: 'x',
    }));
    vi.doMock('../src/lib/config/city-config', () => ({
      getCityConfig: () => ({ videos_cdn_url: CDN }),
      isBlogInstance: () => false,
    }));
  });
  beforeEach(() => vi.resetModules());
  afterAll(() => {
    vi.doUnmock('../src/lib/config/config');
    vi.doUnmock('../src/lib/config/city-config');
  });

  it('strips prefix', async () => {
    const { bareVideoKey } = await import('../src/lib/media/video-service');
    expect(bareVideoKey('montreal-staging/abc12345')).toBe('abc12345');
  });

  it('returns bare key unchanged', async () => {
    const { bareVideoKey } = await import('../src/lib/media/video-service');
    expect(bareVideoKey('abc12345')).toBe('abc12345');
  });

  it('is idempotent', async () => {
    const { bareVideoKey } = await import('../src/lib/media/video-service');
    expect(bareVideoKey(bareVideoKey('prefix/key'))).toBe('key');
  });
});

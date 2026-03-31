/**
 * Video key handling across three deployment scenarios.
 *
 * Every video-related function must handle keys correctly in all three contexts:
 *
 * 1. Production wiki (CITY=montreal, VIDEO_PREFIX=montreal):
 *    - Presign returns "montreal/abcdef" (full S3 path)
 *    - Git saves "abcdef" (prefix matches CITY, derivable at render time)
 *    - Render resolves bare "abcdef" → prefix "montreal"
 *
 * 2. Staging wiki (CITY=montreal, VIDEO_PREFIX=montreal-staging):
 *    - Presign returns "montreal-staging/abcdef" (full S3 path)
 *    - Git saves "montreal-staging/abcdef" (prefix differs from CITY, must persist)
 *    - Render resolves "montreal-staging/abcdef" → uses embedded prefix
 *
 * 3. Blog (CITY=blog, VIDEO_PREFIX=eljojo_bike-blog):
 *    - Presign returns "eljojo_bike-blog/abcdef" (full S3 path)
 *    - Git saves "abcdef" (derivable from VIDEO_PREFIX at render time)
 *    - Render resolves bare "abcdef" → prefix "eljojo_bike-blog"
 *
 * Separate describe blocks with vi.doMock + dynamic imports to test each scenario
 * with its own config values.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';

const CDN = 'https://videos.example.com';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Scenario 1: Production wiki — CITY=montreal, VIDEO_PREFIX=montreal
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

  beforeEach(() => {
    vi.resetModules();
  });

  afterAll(() => {
    vi.doUnmock('../src/lib/config/config');
    vi.doUnmock('../src/lib/config/city-config');
  });

  // ── Serialization (what gets saved to git) ──────────────────────────────
  describe('videoKeyForGit (serialization to git)', () => {
    it('strips CITY prefix from presign key — saves bare key', async () => {
      const { videoKeyForGit } = await import('../src/lib/media/video-service');
      expect(videoKeyForGit('montreal/abcdef')).toBe('abcdef');
    });

    it('passes through bare key unchanged', async () => {
      const { videoKeyForGit } = await import('../src/lib/media/video-service');
      expect(videoKeyForGit('abcdef')).toBe('abcdef');
    });

    it('preserves foreign prefix (staging video re-saved in prod)', async () => {
      const { videoKeyForGit } = await import('../src/lib/media/video-service');
      expect(videoKeyForGit('montreal-staging/abcdef')).toBe('montreal-staging/abcdef');
    });
  });

  // ── Rendering (URL generation from stored keys) ─────────────────────────
  describe('resolveVideoPath (rendering)', () => {
    it('bare key resolves to CITY prefix', async () => {
      const { resolveVideoPath } = await import('../src/lib/media/video-service');
      expect(resolveVideoPath('abcdef')).toEqual({ prefix: 'montreal', bareKey: 'abcdef' });
    });

    it('prefixed key uses embedded prefix', async () => {
      const { resolveVideoPath } = await import('../src/lib/media/video-service');
      expect(resolveVideoPath('montreal-staging/abcdef')).toEqual({
        prefix: 'montreal-staging',
        bareKey: 'abcdef',
      });
    });
  });

  describe('videoPlaybackSources (URL generation)', () => {
    it('bare key produces CITY-prefixed URLs', async () => {
      const { videoPlaybackSources } = await import('../src/lib/media/video-service');
      const sources = videoPlaybackSources('abcdef');
      expect(sources[0].src).toBe(`${CDN}/montreal/abcdef/abcdef.m3u8`);
      expect(sources[1].src).toBe(`${CDN}/montreal/abcdef/abcdef-h264.mp4`);
    });

    it('staging-prefixed key produces staging URLs', async () => {
      const { videoPlaybackSources } = await import('../src/lib/media/video-service');
      const sources = videoPlaybackSources('montreal-staging/abcdef');
      expect(sources[0].src).toBe(`${CDN}/montreal-staging/abcdef/abcdef.m3u8`);
    });
  });

  describe('videoPosterUrl', () => {
    it('bare key produces CITY-prefixed poster URL', async () => {
      const { videoPosterUrl } = await import('../src/lib/media/video-service');
      expect(videoPosterUrl('abcdef')).toBe(`${CDN}/montreal/abcdef/abcdef-poster.0000000.jpg`);
    });
  });

  describe('videoFallbackUrl', () => {
    it('bare key produces CITY-prefixed fallback URL', async () => {
      const { videoFallbackUrl } = await import('../src/lib/media/video-service');
      expect(videoFallbackUrl('abcdef')).toBe(`${CDN}/montreal/abcdef/abcdef-h264.mp4`);
    });
  });

  // ── Transcoding output keys (S3 paths for checking completion) ──────────
  describe('h264OutputKey / posterKeyForVideo (S3 completion check)', () => {
    it('uses VIDEO_PREFIX for S3 output path', async () => {
      const { h264OutputKey, posterKeyForVideo } = await import('../src/lib/media/video-completion');
      expect(h264OutputKey('abcdef')).toBe('montreal/abcdef/abcdef-h264.mp4');
      expect(posterKeyForVideo('abcdef')).toBe('montreal/abcdef/abcdef-poster.0000000.jpg');
    });
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Scenario 2: Staging wiki — CITY=montreal, VIDEO_PREFIX=montreal-staging
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

  beforeEach(() => {
    vi.resetModules();
  });

  afterAll(() => {
    vi.doUnmock('../src/lib/config/config');
    vi.doUnmock('../src/lib/config/city-config');
  });

  // ── Serialization ───────────────────────────────────────────────────────
  describe('videoKeyForGit (serialization to git)', () => {
    it('preserves staging prefix — must persist to git', async () => {
      const { videoKeyForGit } = await import('../src/lib/media/video-service');
      expect(videoKeyForGit('montreal-staging/abcdef')).toBe('montreal-staging/abcdef');
    });

    it('strips CITY prefix (prod video re-saved on staging — bare key resolves via CITY)', async () => {
      const { videoKeyForGit } = await import('../src/lib/media/video-service');
      // montreal/abcdef → bare abcdef is safe because resolveVideoPath uses CITY to reconstruct
      expect(videoKeyForGit('montreal/abcdef')).toBe('abcdef');
    });

    it('bare key from legacy data passes through unchanged', async () => {
      const { videoKeyForGit } = await import('../src/lib/media/video-service');
      expect(videoKeyForGit('abcdef')).toBe('abcdef');
    });
  });

  // ── Rendering ───────────────────────────────────────────────────────────
  describe('resolveVideoPath (rendering)', () => {
    it('bare key resolves to CITY prefix (production path)', async () => {
      const { resolveVideoPath } = await import('../src/lib/media/video-service');
      // Bare keys in media.yml are from production — render with CITY
      expect(resolveVideoPath('abcdef')).toEqual({ prefix: 'montreal', bareKey: 'abcdef' });
    });

    it('staging-prefixed key uses embedded prefix', async () => {
      const { resolveVideoPath } = await import('../src/lib/media/video-service');
      expect(resolveVideoPath('montreal-staging/abcdef')).toEqual({
        prefix: 'montreal-staging',
        bareKey: 'abcdef',
      });
    });
  });

  describe('videoPlaybackSources', () => {
    it('staging-prefixed key produces correct playback URLs', async () => {
      const { videoPlaybackSources } = await import('../src/lib/media/video-service');
      const sources = videoPlaybackSources('montreal-staging/abcdef');
      expect(sources[0].src).toBe(`${CDN}/montreal-staging/abcdef/abcdef.m3u8`);
      expect(sources[1].src).toBe(`${CDN}/montreal-staging/abcdef/abcdef-h264.mp4`);
    });

    it('bare key still resolves to CITY (production videos)', async () => {
      const { videoPlaybackSources } = await import('../src/lib/media/video-service');
      const sources = videoPlaybackSources('abcdef');
      expect(sources[0].src).toBe(`${CDN}/montreal/abcdef/abcdef.m3u8`);
    });
  });

  describe('videoPosterUrl', () => {
    it('staging-prefixed key produces correct poster URL', async () => {
      const { videoPosterUrl } = await import('../src/lib/media/video-service');
      expect(videoPosterUrl('montreal-staging/abcdef')).toBe(
        `${CDN}/montreal-staging/abcdef/abcdef-poster.0000000.jpg`,
      );
    });
  });

  // ── Transcoding output keys ─────────────────────────────────────────────
  describe('h264OutputKey / posterKeyForVideo', () => {
    it('uses VIDEO_PREFIX (staging) for S3 output path', async () => {
      const { h264OutputKey, posterKeyForVideo } = await import('../src/lib/media/video-completion');
      expect(h264OutputKey('abcdef')).toBe('montreal-staging/abcdef/abcdef-h264.mp4');
      expect(posterKeyForVideo('abcdef')).toBe('montreal-staging/abcdef/abcdef-poster.0000000.jpg');
    });
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Scenario 3: Blog — CITY=blog, VIDEO_PREFIX=eljojo_bike-blog
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

  beforeEach(() => {
    vi.resetModules();
  });

  afterAll(() => {
    vi.doUnmock('../src/lib/config/config');
    vi.doUnmock('../src/lib/config/city-config');
  });

  // ── Serialization ───────────────────────────────────────────────────────
  describe('videoKeyForGit (serialization to git)', () => {
    it('strips VIDEO_PREFIX — saves bare key to git', async () => {
      const { videoKeyForGit } = await import('../src/lib/media/video-service');
      expect(videoKeyForGit('eljojo_bike-blog/abcdef')).toBe('abcdef');
    });

    it('passes through bare key unchanged', async () => {
      const { videoKeyForGit } = await import('../src/lib/media/video-service');
      expect(videoKeyForGit('abcdef')).toBe('abcdef');
    });
  });

  // ── Rendering ───────────────────────────────────────────────────────────
  describe('resolveVideoPath (rendering)', () => {
    it('bare key resolves to VIDEO_PREFIX for blog', async () => {
      const { resolveVideoPath } = await import('../src/lib/media/video-service');
      expect(resolveVideoPath('abcdef')).toEqual({
        prefix: 'eljojo_bike-blog',
        bareKey: 'abcdef',
      });
    });

    it('prefixed key uses embedded prefix', async () => {
      const { resolveVideoPath } = await import('../src/lib/media/video-service');
      expect(resolveVideoPath('eljojo_bike-blog/abcdef')).toEqual({
        prefix: 'eljojo_bike-blog',
        bareKey: 'abcdef',
      });
    });
  });

  describe('videoPlaybackSources', () => {
    it('bare key produces VIDEO_PREFIX-prefixed URLs', async () => {
      const { videoPlaybackSources } = await import('../src/lib/media/video-service');
      const sources = videoPlaybackSources('abcdef');
      expect(sources[0].src).toBe(`${CDN}/eljojo_bike-blog/abcdef/abcdef.m3u8`);
      expect(sources[1].src).toBe(`${CDN}/eljojo_bike-blog/abcdef/abcdef-h264.mp4`);
    });
  });

  describe('videoPosterUrl', () => {
    it('bare key produces VIDEO_PREFIX-prefixed poster URL', async () => {
      const { videoPosterUrl } = await import('../src/lib/media/video-service');
      expect(videoPosterUrl('abcdef')).toBe(
        `${CDN}/eljojo_bike-blog/abcdef/abcdef-poster.0000000.jpg`,
      );
    });
  });

  // ── Transcoding output keys ─────────────────────────────────────────────
  describe('h264OutputKey / posterKeyForVideo', () => {
    it('uses VIDEO_PREFIX for S3 output path', async () => {
      const { h264OutputKey } = await import('../src/lib/media/video-completion');
      expect(h264OutputKey('abcdef')).toBe('eljojo_bike-blog/abcdef/abcdef-h264.mp4');
    });
  });
});

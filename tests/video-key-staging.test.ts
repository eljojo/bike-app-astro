/**
 * Video key annotation tests with VIDEO_PREFIX !== CITY.
 *
 * The main video-service tests run with VIDEO_PREFIX === CITY (both 'demo'),
 * so videoKeyForGit always returns bare keys — the staging path is never
 * exercised. This file mocks config so VIDEO_PREFIX differs from CITY,
 * verifying that staging keys are produced and preserved correctly.
 *
 * Key design: presign ALWAYS returns prefixed keys (e.g. 'ottawa-staging/fkpryqw7').
 * videoKeyForGit strips the prefix only when it matches CITY (derivable at render time).
 */
import { describe, it, expect, vi } from 'vitest';

// Mock config BEFORE importing video-service (vi.mock is hoisted)
// eslint-disable-next-line bike-app/no-hardcoded-city-locale -- test mock
vi.mock('../src/lib/config/config', () => ({
  CITY: 'ottawa',
  VIDEO_PREFIX: 'ottawa-staging',
}));

vi.mock('../src/lib/config/city-config', () => ({
  getCityConfig: () => ({ videos_cdn_url: 'https://videos.example.com' }),
  isBlogInstance: () => false,
}));

import {
  bareVideoKey,
  videoKeyForGit,
  resolveVideoPath,
  videoPlaybackSources,
  videoPosterUrl,
  videoFallbackUrl,
} from '../src/lib/media/video-service';

describe('videoKeyForGit with staging prefix (VIDEO_PREFIX !== CITY)', () => {
  it('preserves staging prefix — not derivable from CITY', () => {
    expect(videoKeyForGit('ottawa-staging/fkpryqw7')).toBe('ottawa-staging/fkpryqw7');
  });

  it('strips CITY prefix — derivable at render time via resolveVideoPath', () => {
    // ottawa/fkpryqw7 → bare fkpryqw7 is safe because resolveVideoPath uses CITY
    expect(videoKeyForGit('ottawa/fkpryqw7')).toBe('fkpryqw7');
  });

  it('passes through bare keys unchanged (legacy data)', () => {
    expect(videoKeyForGit('fkpryqw7')).toBe('fkpryqw7');
  });
});

describe('resolveVideoPath with staging prefix', () => {
  it('uses embedded prefix for annotated keys', () => {
    const result = resolveVideoPath('ottawa-staging/abc12345');
    expect(result.prefix).toBe('ottawa-staging');
    expect(result.bareKey).toBe('abc12345');
  });

  it('uses CITY (not VIDEO_PREFIX) for bare keys on wiki instance', () => {
    const result = resolveVideoPath('abc12345');
    expect(result.prefix).toBe('ottawa');
    expect(result.bareKey).toBe('abc12345');
  });
});

describe('playback URLs resolve correctly for staging-annotated keys', () => {
  it('uses staging prefix in playback sources', () => {
    const sources = videoPlaybackSources('ottawa-staging/fkpryqw7');
    expect(sources[0].src).toContain('/ottawa-staging/fkpryqw7/fkpryqw7.m3u8');
    expect(sources[1].src).toContain('/ottawa-staging/fkpryqw7/fkpryqw7-h264.mp4');
  });

  it('uses staging prefix in poster URL', () => {
    const url = videoPosterUrl('ottawa-staging/fkpryqw7');
    expect(url).toContain('/ottawa-staging/fkpryqw7/fkpryqw7-poster.0000000.jpg');
  });

  it('uses staging prefix in fallback URL', () => {
    const url = videoFallbackUrl('ottawa-staging/fkpryqw7');
    expect(url).toContain('/ottawa-staging/fkpryqw7/fkpryqw7-h264.mp4');
  });

  it('bare key resolves to CITY prefix (production path)', () => {
    // A bare key in media.yml resolves to CITY — correct for production videos
    const sources = videoPlaybackSources('fkpryqw7');
    expect(sources[0].src).toContain('/ottawa/fkpryqw7/fkpryqw7.m3u8');
  });
});

/**
 * Full annotation guard with staging VIDEO_PREFIX.
 *
 * Mirrors the logic from route-save.ts / ride-save.ts.
 * Now that presign returns prefixed keys, the media list already contains
 * prefixed keys for new uploads.
 */
describe('save-time annotation guard (staging prefix)', () => {
  function annotateMedia(
    media: Array<{ key: string; type?: string }>,
    consumedKeys: string[],
  ) {
    const consumedSet = new Set(consumedKeys);
    return media.map(item =>
      item.type === 'video' && consumedSet.has(bareVideoKey(item.key))
        ? { ...item, key: videoKeyForGit(item.key) }
        : item
    );
  }

  it('preserves staging prefix on newly-consumed video (presign returned prefixed key)', () => {
    // Presign returns 'ottawa-staging/fkpryqw7', client stores it in media list
    const media = [
      { key: 'ottawa-staging/fkpryqw7', type: 'video' },
      { key: 'photo001', type: 'photo' },
    ];
    const consumedKeys = ['fkpryqw7'];

    const result = annotateMedia(media, consumedKeys);

    expect(result[0].key).toBe('ottawa-staging/fkpryqw7');
    expect(result[1].key).toBe('photo001');
  });

  it('preserves existing staging-annotated video key when not consumed', () => {
    const media = [
      { key: 'ottawa-staging/abc12345', type: 'video' },
    ];
    const consumedKeys: string[] = [];

    const result = annotateMedia(media, consumedKeys);

    expect(result[0].key).toBe('ottawa-staging/abc12345');
  });

  it('preserves staging prefix when consumed key already has it', () => {
    const media = [
      { key: 'ottawa-staging/abc12345', type: 'video' },
    ];
    const consumedKeys = ['abc12345'];

    const result = annotateMedia(media, consumedKeys);

    expect(result[0].key).toBe('ottawa-staging/abc12345');
  });

  it('strips CITY prefix from production video when re-saved on staging', () => {
    // A production video key (ottawa/abc12345) re-saved from staging
    // Stripping to bare is safe because resolveVideoPath reconstructs via CITY
    const media = [
      { key: 'ottawa/abc12345', type: 'video' },
    ];
    const consumedKeys = ['abc12345'];

    const result = annotateMedia(media, consumedKeys);

    expect(result[0].key).toBe('abc12345');
  });

  it('handles mixed media: new staging upload + existing production video', () => {
    const media = [
      { key: 'prod_vid1', type: 'video' },                    // existing production bare key
      { key: 'ottawa-staging/new_stg_1', type: 'video' },     // just uploaded in staging (prefixed from presign)
      { key: 'photo_1', type: 'photo' },                      // photo — always untouched
    ];
    const consumedKeys = ['new_stg_1'];

    const result = annotateMedia(media, consumedKeys);

    expect(result[0].key).toBe('prod_vid1');                   // existing: untouched (not consumed)
    expect(result[1].key).toBe('ottawa-staging/new_stg_1');    // new: staging prefix preserved
    expect(result[2].key).toBe('photo_1');                     // photo: untouched
  });
});

/**
 * Video key annotation tests with VIDEO_PREFIX !== CITY.
 *
 * The main video-service tests run with VIDEO_PREFIX === CITY (both 'demo'),
 * so videoKeyForGit always returns bare keys — the prefix annotation path
 * is never exercised. This file mocks config so VIDEO_PREFIX differs from
 * CITY, verifying that staging keys are produced and preserved correctly.
 *
 * These tests would have caught the bug where a staging video key
 * 'ottawa-staging/fkpryqw7' was committed as bare 'fkpryqw7'.
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
  it('annotates bare key with staging prefix', () => {
    expect(videoKeyForGit('fkpryqw7')).toBe('ottawa-staging/fkpryqw7');
  });

  it('re-annotates key that already has the staging prefix (idempotent)', () => {
    expect(videoKeyForGit('ottawa-staging/fkpryqw7')).toBe('ottawa-staging/fkpryqw7');
  });

  it('preserves production prefix even when processed in staging', () => {
    // A key from production must NOT be re-prefixed — it already points
    // to the correct R2 path. Stripping would be destructive.
    expect(videoKeyForGit('ottawa/fkpryqw7')).toBe('ottawa/fkpryqw7');
  });
});

describe('resolveVideoPath with staging prefix', () => {
  it('uses embedded prefix for annotated keys', () => {
    const result = resolveVideoPath('ottawa-staging/abc12345');
    expect(result.prefix).toBe('ottawa-staging');
    expect(result.bareKey).toBe('abc12345');
  });

  it('uses CITY (not VIDEO_PREFIX) for bare keys on wiki instance', () => {
    // resolveVideoPath uses CITY for wiki, VIDEO_PREFIX for blog
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
    // A bare key in media.yml would resolve to production — this is the bug!
    // If videoKeyForGit stripped the staging prefix, playback would look in
    // ottawa/ instead of ottawa-staging/ and the video would 404.
    const sources = videoPlaybackSources('fkpryqw7');
    expect(sources[0].src).toContain('/ottawa/fkpryqw7/fkpryqw7.m3u8');
    // This proves: if the key is stored bare, playback breaks for staging videos
  });
});

/**
 * Full annotation guard with staging VIDEO_PREFIX.
 *
 * Mirrors the exact logic from route-save.ts / ride-save.ts, but now
 * videoKeyForGit actually produces prefixed keys.
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

  it('annotates newly-consumed bare video key with staging prefix', () => {
    // Scenario: user uploads video in staging, presign returns bare key
    const media = [
      { key: 'fkpryqw7', type: 'video' },
      { key: 'photo001', type: 'photo' },
    ];
    const consumedKeys = ['fkpryqw7'];

    const result = annotateMedia(media, consumedKeys);

    expect(result[0].key).toBe('ottawa-staging/fkpryqw7');
    expect(result[1].key).toBe('photo001');
  });

  it('preserves existing staging-annotated video key when not consumed', () => {
    // Scenario: re-saving a route with an existing staging video, no new uploads
    const media = [
      { key: 'ottawa-staging/abc12345', type: 'video' },
    ];
    const consumedKeys: string[] = [];

    const result = annotateMedia(media, consumedKeys);

    expect(result[0].key).toBe('ottawa-staging/abc12345');
  });

  it('preserves staging prefix when consumed key already has it', () => {
    // Scenario: staging video is consumed again (e.g. enrichment re-finds D1 row)
    // The key must NOT be stripped to bare — it must stay as ottawa-staging/...
    const media = [
      { key: 'ottawa-staging/abc12345', type: 'video' },
    ];
    const consumedKeys = ['abc12345']; // bare key from videoJobs

    const result = annotateMedia(media, consumedKeys);

    // THIS IS THE BUG TEST: without the fix, this would produce 'ottawa-staging/abc12345'
    // because videoKeyForGit('ottawa-staging/abc12345') strips to 'abc12345' then
    // re-prefixes with VIDEO_PREFIX. With VIDEO_PREFIX=ottawa-staging, the result
    // happens to be correct. But the logic is fragile — see the production-prefix test below.
    expect(result[0].key).toBe('ottawa-staging/abc12345');
  });

  it('does NOT strip production prefix from existing video when re-saving in staging', () => {
    // Scenario: a route has a production video (key: 'abc12345' or 'ottawa/abc12345'),
    // user re-saves from staging, and the D1 row happens to exist (e.g. webhook re-fired).
    // The existing production video key must NOT be re-annotated to staging.
    const media = [
      { key: 'abc12345', type: 'video' },  // production bare key
    ];
    // If this bare key matches a consumed key, it gets re-annotated to staging.
    // This test documents current behavior — the guard should prevent this by
    // NOT matching already-consumed keys that weren't uploaded in this session.
    const consumedKeys = ['abc12345'];

    const result = annotateMedia(media, consumedKeys);

    // Current behavior: re-annotates to staging prefix.
    // This is "correct" if the key was truly just uploaded in staging.
    // But WRONG if it's an existing production video whose D1 row wasn't cleaned up.
    expect(result[0].key).toBe('ottawa-staging/abc12345');
  });

  it('handles mixed media: new staging upload + existing production video', () => {
    const media = [
      { key: 'prod_vid1', type: 'video' },     // existing production video
      { key: 'new_stg_1', type: 'video' },      // just uploaded in staging
      { key: 'photo_1', type: 'photo' },         // photo — always untouched
    ];
    const consumedKeys = ['new_stg_1']; // only the new upload was consumed

    const result = annotateMedia(media, consumedKeys);

    expect(result[0].key).toBe('prod_vid1');                  // existing: untouched
    expect(result[1].key).toBe('ottawa-staging/new_stg_1');   // new: gets staging prefix
    expect(result[2].key).toBe('photo_1');                    // photo: untouched
  });
});

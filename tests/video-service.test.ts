import { describe, it, expect } from 'vitest';
import {
  videoPlaybackSources,
  videoPosterUrl,
  buildVideoPosterUrl,
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
  it('preserves existing prefix — never strips an already-annotated key', () => {
    expect(videoKeyForGit('some-prefix/abc12345')).toBe('some-prefix/abc12345');
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
  it('uses videos CDN with cdn-cgi/image transform (not a separate image CDN)', () => {
    const url = videoPosterUrl('abc123');
    expect(url).toContain('cdn-cgi/image/format=auto');
    // Must use the videos CDN, not a separate image CDN
    const VIDEOS_CDN = url.split('/cdn-cgi/')[0];
    expect(VIDEOS_CDN).not.toContain('images.');
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

/**
 * Save-time annotation: the save pipeline applies videoKeyForGit ONLY to
 * newly-consumed keys (those returned by enrichMediaFromVideoJobs). Existing
 * video keys must pass through unchanged — re-annotating would retarget
 * production videos to staging paths or vice versa.
 *
 * This replicates the exact annotation pattern from route-save.ts / ride-save.ts.
 */
describe('save-time annotation guard', () => {
  // Helper that mirrors the exact logic in route-save.ts / ride-save.ts
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

  it('does NOT annotate existing video keys when no keys were consumed', () => {
    // Scenario: re-saving a route with an existing production video, no new uploads
    const media = [
      { key: 'abc12345', type: 'video' },
      { key: 'photo001', type: 'photo' },
    ];
    const consumedKeys: string[] = [];

    const result = annotateMedia(media, consumedKeys);

    expect(result[0].key).toBe('abc12345'); // video key unchanged
    expect(result[1].key).toBe('photo001'); // photo unchanged
  });

  it('does NOT annotate existing annotated video keys on re-save', () => {
    // Scenario: route has a staging-annotated video, user re-saves from staging
    const media = [
      { key: 'ottawa-staging/abc12345', type: 'video' },
      { key: 'def67890', type: 'video' },
    ];
    const consumedKeys: string[] = [];

    const result = annotateMedia(media, consumedKeys);

    expect(result[0].key).toBe('ottawa-staging/abc12345'); // preserved
    expect(result[1].key).toBe('def67890'); // preserved
  });

  it('annotates ONLY the newly-consumed video key', () => {
    // Scenario: route has one existing video, user uploads a new one
    const media = [
      { key: 'existing1', type: 'video' },
      { key: 'newvideo', type: 'video' },
      { key: 'photo001', type: 'photo' },
    ];
    // In test env, VIDEO_PREFIX === CITY, so videoKeyForGit returns bare key.
    // The important thing: only 'newvideo' goes through videoKeyForGit.
    const consumedKeys = ['newvideo'];

    const result = annotateMedia(media, consumedKeys);

    expect(result[0].key).toBe('existing1'); // existing video: untouched
    expect(result[1].key).toBe('newvideo');  // new video: processed by videoKeyForGit
    expect(result[2].key).toBe('photo001');  // photo: always untouched
  });

  it('preserves existing prefix even when bare key matches consumed set', () => {
    // Scenario: media item already has a staging prefix, and the bare key
    // appears in consumedKeys (videoJobs stores bare keys).
    // videoKeyForGit must NOT strip the existing prefix.
    const media = [
      { key: 'ottawa-staging/abc12345', type: 'video' },
    ];
    // enrichMediaFromVideoJobs returns bare keys in consumedKeys
    const consumedKeys = ['abc12345'];

    const result = annotateMedia(media, consumedKeys);

    // The prefix must survive — stripping it would point playback at the
    // wrong R2 path (production instead of staging).
    expect(result[0].key).toBe('ottawa-staging/abc12345');
  });

  it('leaves photos and non-video items completely untouched', () => {
    const media = [
      { key: 'photo1', type: 'photo' },
      { key: 'photo2', type: 'photo' },
    ];
    const consumedKeys = ['photo1']; // even if key is in consumed, photos skip

    const result = annotateMedia(media, consumedKeys);

    expect(result[0].key).toBe('photo1');
    expect(result[1].key).toBe('photo2');
  });

  it('handles mixed media with multiple consumed keys', () => {
    const media = [
      { key: 'old_vid_1', type: 'video' },
      { key: 'new_vid_1', type: 'video' },
      { key: 'photo_1', type: 'photo' },
      { key: 'new_vid_2', type: 'video' },
      { key: 'old_vid_2', type: 'video' },
    ];
    const consumedKeys = ['new_vid_1', 'new_vid_2'];

    const result = annotateMedia(media, consumedKeys);

    expect(result[0].key).toBe('old_vid_1');  // existing: untouched
    expect(result[1].key).toBe('new_vid_1');  // consumed: annotated (bare in test env)
    expect(result[2].key).toBe('photo_1');    // photo: untouched
    expect(result[3].key).toBe('new_vid_2');  // consumed: annotated (bare in test env)
    expect(result[4].key).toBe('old_vid_2');  // existing: untouched
  });
});

describe('buildVideoPosterUrl', () => {
  const cdn = 'https://videos.example.com';

  it('handles prefixed key', () => {
    expect(buildVideoPosterUrl(cdn, 'ottawa/abc12345'))
      .toBe('https://videos.example.com/ottawa/abc12345/abc12345-poster.0000000.jpg');
  });

  it('handles bare key with default prefix', () => {
    expect(buildVideoPosterUrl(cdn, 'abc12345', 'ottawa'))
      .toBe('https://videos.example.com/ottawa/abc12345/abc12345-poster.0000000.jpg');
  });

  it('handles bare key without prefix', () => {
    expect(buildVideoPosterUrl(cdn, 'abc12345'))
      .toBe('https://videos.example.com/abc12345/abc12345-poster.0000000.jpg');
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

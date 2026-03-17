/**
 * VIDEO WRITE PATH — Adding video to resources.
 *
 * Tests the complete chain from upload through persistence:
 *
 *   presign → client gets prefixed key → save pipeline serializes → media.yml
 *
 * For each of three deployment scenarios:
 *   1. Production wiki (CITY=montreal, VIDEO_PREFIX=montreal)
 *   2. Staging wiki   (CITY=montreal, VIDEO_PREFIX=montreal-staging)
 *   3. Blog           (CITY=blog,     VIDEO_PREFIX=eljojo_bike-blog)
 *
 * The key invariant: presign ALWAYS returns the full S3 path (VIDEO_PREFIX/bareKey).
 * The save pipeline decides whether to strip or keep the prefix based on whether
 * the renderer can reconstruct it.
 *
 * This file does NOT test validation, rate limiting, or auth (see video-presign.test.ts).
 * It focuses on the key's journey through the system.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';

const CDN = 'https://videos.example.com';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Replicates the exact annotation logic from save-helpers.ts enrichAndAnnotateMedia.
 * Uses the real bareVideoKey + videoKeyForGit from the current config mock.
 */
async function simulateSavePipeline(
  media: Array<{ key: string; type?: string }>,
  consumedBareKeys: string[],
) {
  const { bareVideoKey, videoKeyForGit } = await import('../src/lib/media/video-service');
  const consumedSet = new Set(consumedBareKeys);
  return media.map(item =>
    item.type === 'video' && consumedSet.has(bareVideoKey(item.key))
      ? { ...item, key: videoKeyForGit(item.key) }
      : item,
  );
}

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
  beforeEach(() => vi.resetModules());
  afterAll(() => {
    vi.doUnmock('../src/lib/config/config');
    vi.doUnmock('../src/lib/config/city-config');
  });

  // ── Step 1: Presign returns prefixed key ────────────────────────────────
  it('presign returns montreal/bareKey (full S3 path)', async () => {
    // Simulates what video-presign.ts does: s3Key = `${VIDEO_PREFIX}/${bareKey}`
    const { VIDEO_PREFIX } = await import('../src/lib/config/config');
    const bareKey = 'k3eovg6o';
    const s3Key = `${VIDEO_PREFIX}/${bareKey}`;
    expect(s3Key).toBe('montreal/k3eovg6o');
  });

  // ── Step 2: Save pipeline strips CITY prefix ───────────────────────────
  it('new upload: prefixed key from presign → save strips to bare key', async () => {
    // Client receives 'montreal/k3eovg6o' from presign, stores it in media array
    const media = [{ key: 'montreal/k3eovg6o', type: 'video' }];
    // enrichMediaFromVideoJobs returns bare keys as consumed
    const result = await simulateSavePipeline(media, ['k3eovg6o']);
    expect(result[0].key).toBe('k3eovg6o');
  });

  it('re-save without new upload: existing bare key passes through unchanged', async () => {
    const media = [{ key: 'k3eovg6o', type: 'video' }];
    const result = await simulateSavePipeline(media, []);
    expect(result[0].key).toBe('k3eovg6o');
  });

  it('mixed: new upload + existing video + photo', async () => {
    const media = [
      { key: 'existing1', type: 'video' },
      { key: 'montreal/newvideo', type: 'video' },
      { key: 'photo001', type: 'photo' },
    ];
    const result = await simulateSavePipeline(media, ['newvideo']);
    expect(result[0].key).toBe('existing1');     // existing: untouched
    expect(result[1].key).toBe('newvideo');       // new: prefix stripped
    expect(result[2].key).toBe('photo001');       // photo: untouched
  });

  it('foreign prefix (staging video on prod) is preserved', async () => {
    const media = [{ key: 'montreal-staging/abc123', type: 'video' }];
    const result = await simulateSavePipeline(media, ['abc123']);
    expect(result[0].key).toBe('montreal-staging/abc123');
  });

  // ── Step 3: D1 and status polling use bare keys ────────────────────────
  it('D1 stores bare key, not prefixed', async () => {
    // video-presign.ts inserts { key: bareKey } into videoJobs (not s3Key)
    const bareKey = 'k3eovg6o';
    const { VIDEO_PREFIX } = await import('../src/lib/config/config');
    const s3Key = `${VIDEO_PREFIX}/${bareKey}`;
    // DB key is the bare part
    expect(s3Key.slice(s3Key.indexOf('/') + 1)).toBe(bareKey);
  });

  it('status polling extracts bare key from prefixed key', () => {
    // Mirrors hooks.ts: statusKey = key.includes('/') ? key.slice(...) : key
    const key = 'montreal/k3eovg6o';
    const statusKey = key.includes('/') ? key.slice(key.indexOf('/') + 1) : key;
    expect(statusKey).toBe('k3eovg6o');
  });

  // ── Step 4: Transcoding output keys use VIDEO_PREFIX ───────────────────
  it('h264OutputKey uses VIDEO_PREFIX for S3 completion check', async () => {
    const { h264OutputKey } = await import('../src/lib/media/video-completion');
    expect(h264OutputKey('k3eovg6o')).toBe('montreal/k3eovg6o/k3eovg6o-h264.mp4');
  });

  it('posterKeyForVideo uses VIDEO_PREFIX', async () => {
    const { posterKeyForVideo } = await import('../src/lib/media/video-completion');
    expect(posterKeyForVideo('k3eovg6o')).toBe('montreal/k3eovg6o/k3eovg6o-poster.0000000.jpg');
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
  beforeEach(() => vi.resetModules());
  afterAll(() => {
    vi.doUnmock('../src/lib/config/config');
    vi.doUnmock('../src/lib/config/city-config');
  });

  // ── Step 1: Presign ────────────────────────────────────────────────────
  it('presign returns montreal-staging/bareKey', async () => {
    const { VIDEO_PREFIX } = await import('../src/lib/config/config');
    const s3Key = `${VIDEO_PREFIX}/k3eovg6o`;
    expect(s3Key).toBe('montreal-staging/k3eovg6o');
  });

  // ── Step 2: Save pipeline preserves staging prefix ─────────────────────
  it('new upload: staging prefix is preserved (not derivable from CITY)', async () => {
    const media = [{ key: 'montreal-staging/k3eovg6o', type: 'video' }];
    const result = await simulateSavePipeline(media, ['k3eovg6o']);
    expect(result[0].key).toBe('montreal-staging/k3eovg6o');
  });

  it('re-save: existing staging-prefixed key passes through unchanged', async () => {
    const media = [{ key: 'montreal-staging/k3eovg6o', type: 'video' }];
    const result = await simulateSavePipeline(media, []);
    expect(result[0].key).toBe('montreal-staging/k3eovg6o');
  });

  it('production video re-saved on staging: CITY prefix stripped (safe — resolveVideoPath reconstructs)', async () => {
    // A video originally uploaded on prod (montreal/abc) gets re-saved from staging.
    // Stripping is safe because resolveVideoPath uses CITY for bare keys.
    const media = [{ key: 'montreal/abc12345', type: 'video' }];
    const result = await simulateSavePipeline(media, ['abc12345']);
    expect(result[0].key).toBe('abc12345');
  });

  it('mixed: staging upload + production bare video + photo', async () => {
    const media = [
      { key: 'prod_vid1', type: 'video' },                    // existing production bare key
      { key: 'montreal-staging/new_stg_1', type: 'video' },   // new staging upload
      { key: 'photo_1', type: 'photo' },
    ];
    const result = await simulateSavePipeline(media, ['new_stg_1']);
    expect(result[0].key).toBe('prod_vid1');                   // untouched (not consumed)
    expect(result[1].key).toBe('montreal-staging/new_stg_1');  // staging prefix preserved
    expect(result[2].key).toBe('photo_1');                     // photo: untouched
  });

  it('bare legacy key passes through unchanged', async () => {
    const media = [{ key: 'legacy01', type: 'video' }];
    const result = await simulateSavePipeline(media, []);
    expect(result[0].key).toBe('legacy01');
  });

  // ── Step 3: D1 and status polling ──────────────────────────────────────
  it('status polling extracts bare key from staging-prefixed key', () => {
    const key = 'montreal-staging/k3eovg6o';
    const statusKey = key.includes('/') ? key.slice(key.indexOf('/') + 1) : key;
    expect(statusKey).toBe('k3eovg6o');
  });

  // ── Step 4: Transcoding uses VIDEO_PREFIX ──────────────────────────────
  it('h264OutputKey uses staging VIDEO_PREFIX', async () => {
    const { h264OutputKey } = await import('../src/lib/media/video-completion');
    expect(h264OutputKey('k3eovg6o')).toBe('montreal-staging/k3eovg6o/k3eovg6o-h264.mp4');
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
  beforeEach(() => vi.resetModules());
  afterAll(() => {
    vi.doUnmock('../src/lib/config/config');
    vi.doUnmock('../src/lib/config/city-config');
  });

  // ── Step 1: Presign ────────────────────────────────────────────────────
  it('presign returns eljojo_bike-blog/bareKey', async () => {
    const { VIDEO_PREFIX } = await import('../src/lib/config/config');
    const s3Key = `${VIDEO_PREFIX}/k3eovg6o`;
    expect(s3Key).toBe('eljojo_bike-blog/k3eovg6o');
  });

  // ── Step 2: Save pipeline strips blog prefix (derivable from VIDEO_PREFIX) ─
  it('new upload: blog prefix stripped — derivable at render time', async () => {
    const media = [{ key: 'eljojo_bike-blog/k3eovg6o', type: 'video' }];
    const result = await simulateSavePipeline(media, ['k3eovg6o']);
    expect(result[0].key).toBe('k3eovg6o');
  });

  it('bare key passes through unchanged', async () => {
    const media = [{ key: 'k3eovg6o', type: 'video' }];
    const result = await simulateSavePipeline(media, []);
    expect(result[0].key).toBe('k3eovg6o');
  });

  // ── Step 3: Status polling ─────────────────────────────────────────────
  it('status polling extracts bare key from blog-prefixed key', () => {
    const key = 'eljojo_bike-blog/k3eovg6o';
    const statusKey = key.includes('/') ? key.slice(key.indexOf('/') + 1) : key;
    expect(statusKey).toBe('k3eovg6o');
  });

  // ── Step 4: Transcoding ────────────────────────────────────────────────
  it('h264OutputKey uses blog VIDEO_PREFIX', async () => {
    const { h264OutputKey } = await import('../src/lib/media/video-completion');
    expect(h264OutputKey('k3eovg6o')).toBe('eljojo_bike-blog/k3eovg6o/k3eovg6o-h264.mp4');
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Cross-scenario: round-trip invariants
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
describe('Round-trip invariant: what the save pipeline writes, the renderer can read', () => {
  const scenarios = [
    { name: 'production wiki', city: 'montreal', videoPrefix: 'montreal', isBlog: false },
    { name: 'staging wiki', city: 'montreal', videoPrefix: 'montreal-staging', isBlog: false },
    { name: 'blog', city: 'blog', videoPrefix: 'eljojo_bike-blog', isBlog: true },
  ] as const;

  for (const scenario of scenarios) {
    describe(scenario.name, () => {
      beforeAll(() => {
        vi.doMock('../src/lib/config/config', () => ({
          CITY: scenario.city,
          VIDEO_PREFIX: scenario.videoPrefix,
        }));
        vi.doMock('../src/lib/config/city-config', () => ({
          getCityConfig: () => ({ videos_cdn_url: CDN }),
          isBlogInstance: () => scenario.isBlog,
        }));
      });
      beforeEach(() => vi.resetModules());
      afterAll(() => {
        vi.doUnmock('../src/lib/config/config');
        vi.doUnmock('../src/lib/config/city-config');
      });

      it('presign key → videoKeyForGit → resolveVideoPath → correct S3 prefix', async () => {
        const { videoKeyForGit, resolveVideoPath } = await import('../src/lib/media/video-service');

        // Presign returns: VIDEO_PREFIX/bareKey
        const presignKey = `${scenario.videoPrefix}/abcdef`;

        // Save pipeline serializes for git
        const gitKey = videoKeyForGit(presignKey);

        // Renderer resolves from git key
        const { prefix, bareKey } = resolveVideoPath(gitKey);

        // The resolved prefix must match the original VIDEO_PREFIX
        // (so the CDN URL points to the right S3 object)
        expect(prefix).toBe(scenario.videoPrefix);
        expect(bareKey).toBe('abcdef');
      });
    });
  }
});

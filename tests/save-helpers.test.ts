import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/lib/media/video-enrichment', () => ({
  enrichMediaFromVideoJobs: vi.fn(),
  deleteConsumedVideoJobs: vi.fn(),
}));

vi.mock('../src/lib/media/media-parking.server', () => ({
  updateMediaRegistryCache: vi.fn(),
}));

vi.mock('../src/lib/media/video-service', () => ({
  bareVideoKey: vi.fn((key: string) => {
    const idx = key.indexOf('/');
    return idx !== -1 ? key.slice(idx + 1) : key;
  }),
  videoKeyForGit: vi.fn((key: string) => {
    if (key.includes('/')) return key;
    return `prefix/${key}`;
  }),
}));

import { enrichAndAnnotateMedia, afterCommitMediaCleanup } from '../src/lib/content/save-helpers.server';
import { enrichMediaFromVideoJobs, deleteConsumedVideoJobs } from '../src/lib/media/video-enrichment';
import { updateMediaRegistryCache } from '../src/lib/media/media-parking.server';

const mockEnrich = vi.mocked(enrichMediaFromVideoJobs);
const mockUpdateRegistry = vi.mocked(updateMediaRegistryCache);
const mockDeleteVideoJobs = vi.mocked(deleteConsumedVideoJobs);

describe('enrichAndAnnotateMedia', () => {
  const fakeDb = {} as Parameters<typeof enrichAndAnnotateMedia>[1];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns enriched media with consumed video keys annotated via videoKeyForGit', async () => {
    const media = [
      { key: 'vid_abc', type: 'video' },
      { key: 'photo_1', type: 'photo' },
    ];
    mockEnrich.mockResolvedValue({
      enrichedMedia: [
        { ...media[0], duration: 30 } as typeof media[0] & { duration: number },
        media[1],
      ],
      consumedKeys: ['vid_abc'],
    });

    const { annotatedMedia, consumedVideoKeys } = await enrichAndAnnotateMedia(media, fakeDb);

    expect(annotatedMedia[0].key).toBe('prefix/vid_abc');
    expect((annotatedMedia[0] as Record<string, unknown>).duration).toBe(30);
    expect(annotatedMedia[1].key).toBe('photo_1');
    expect(consumedVideoKeys).toEqual(['vid_abc']);
  });

  it('leaves non-video items unchanged', async () => {
    const media = [
      { key: 'photo_1', type: 'photo' },
      { key: 'photo_2', type: 'photo' },
    ];
    mockEnrich.mockResolvedValue({
      enrichedMedia: [...media],
      consumedKeys: [],
    });

    const { annotatedMedia } = await enrichAndAnnotateMedia(media, fakeDb);

    expect(annotatedMedia[0].key).toBe('photo_1');
    expect(annotatedMedia[1].key).toBe('photo_2');
  });

  it('leaves non-consumed video items unchanged', async () => {
    const media = [
      { key: 'existing/vid_old', type: 'video' },
      { key: 'vid_new', type: 'video' },
    ];
    mockEnrich.mockResolvedValue({
      enrichedMedia: [...media],
      consumedKeys: ['vid_new'],
    });

    const { annotatedMedia } = await enrichAndAnnotateMedia(media, fakeDb);

    // existing/vid_old is not consumed, so it stays as-is
    expect(annotatedMedia[0].key).toBe('existing/vid_old');
    // vid_new is consumed and bare, so it gets annotated
    expect(annotatedMedia[1].key).toBe('prefix/vid_new');
  });

  it('returns empty consumedVideoKeys when no videos are enriched', async () => {
    const media = [{ key: 'photo_1', type: 'photo' }];
    mockEnrich.mockResolvedValue({
      enrichedMedia: [...media],
      consumedKeys: [],
    });

    const { annotatedMedia, consumedVideoKeys } = await enrichAndAnnotateMedia(media, fakeDb);

    expect(consumedVideoKeys).toEqual([]);
    expect(annotatedMedia).toHaveLength(1);
  });
});

describe('afterCommitMediaCleanup', () => {
  const fakeDb = {} as Parameters<typeof afterCommitMediaCleanup>[0]['database'];
  const fakeSharedKeys = {} as Record<string, Array<{ type: string; slug: string }>>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateRegistry.mockResolvedValue(undefined);
    mockDeleteVideoJobs.mockResolvedValue(undefined);
  });

  it('calls updateMediaRegistryCache with key changes', async () => {
    const changes = [{ key: 'photo_1', usage: { type: 'route' as const, slug: 'my-route' }, action: 'add' as const }];
    await afterCommitMediaCleanup({
      database: fakeDb,
      sharedKeysData: fakeSharedKeys,
      mediaKeyChanges: changes,
    });

    expect(mockUpdateRegistry).toHaveBeenCalledWith({
      database: fakeDb,
      sharedKeysData: fakeSharedKeys,
      keyChanges: changes,
    });
    expect(mockDeleteVideoJobs).not.toHaveBeenCalled();
  });

  it('calls deleteConsumedVideoJobs when consumedVideoKeys has entries', async () => {
    const changes = [{ key: 'vid_1', usage: { type: 'route' as const, slug: 'r' }, action: 'add' as const }];
    await afterCommitMediaCleanup({
      database: fakeDb,
      sharedKeysData: fakeSharedKeys,
      mediaKeyChanges: changes,
      consumedVideoKeys: ['vid_1', 'vid_2'],
    });

    expect(mockUpdateRegistry).toHaveBeenCalledOnce();
    expect(mockDeleteVideoJobs).toHaveBeenCalledWith(['vid_1', 'vid_2'], fakeDb);
  });

  it('skips deleteConsumedVideoJobs when consumedVideoKeys is empty', async () => {
    await afterCommitMediaCleanup({
      database: fakeDb,
      sharedKeysData: fakeSharedKeys,
      mediaKeyChanges: [],
      consumedVideoKeys: [],
    });

    expect(mockUpdateRegistry).toHaveBeenCalledOnce();
    expect(mockDeleteVideoJobs).not.toHaveBeenCalled();
  });

  it('skips deleteConsumedVideoJobs when consumedVideoKeys is undefined', async () => {
    await afterCommitMediaCleanup({
      database: fakeDb,
      sharedKeysData: fakeSharedKeys,
      mediaKeyChanges: [],
    });

    expect(mockUpdateRegistry).toHaveBeenCalledOnce();
    expect(mockDeleteVideoJobs).not.toHaveBeenCalled();
  });

  it('passes mergedParked to updateMediaRegistryCache when provided', async () => {
    const parked = [{ key: 'p1', lat: 45, lng: -75 }];
    await afterCommitMediaCleanup({
      database: fakeDb,
      sharedKeysData: fakeSharedKeys,
      mediaKeyChanges: [],
      mergedParked: parked,
    });

    expect(mockUpdateRegistry).toHaveBeenCalledWith({
      database: fakeDb,
      sharedKeysData: fakeSharedKeys,
      keyChanges: [],
      mergedParked: parked,
    });
  });
});

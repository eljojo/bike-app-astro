import { describe, it, expect, vi } from 'vitest';
import { enrichMediaFromVideoJobs, deleteConsumedVideoJobs } from '../../../src/lib/media/video-enrichment';
import { CITY } from '../../../src/lib/config/config';

describe('enrichMediaFromVideoJobs', () => {
  it('enriches video items with ready videoJobs metadata', async () => {
    const media = [
      { key: 'photo1', type: 'photo' },
      { key: 'vid123', type: 'video', title: 'Test' },
    ];
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([
        { key: 'vid123', status: 'ready', width: 1920, height: 1080, duration: 'PT30S', orientation: 'landscape', lat: null, lng: null, capturedAt: null },
      ]),
    };

    const result = await enrichMediaFromVideoJobs(media, mockDb as any);
    expect(result.enrichedMedia[1]).toMatchObject({
      key: 'vid123', type: 'video', title: 'Test',
      width: 1920, height: 1080, duration: 'PT30S', orientation: 'landscape',
    });
    expect(result.consumedKeys).toEqual(['vid123']);
  });

  it('returns original media when no video items exist', async () => {
    const media = [{ key: 'photo1', type: 'photo' }];
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([]),
    };
    const result = await enrichMediaFromVideoJobs(media, mockDb as any);
    expect(result.enrichedMedia).toEqual(media);
    expect(result.consumedKeys).toEqual([]);
  });

  it('returns original media when no video keys at all', async () => {
    const media = [{ key: 'photo1', type: 'photo' }];
    const result = await enrichMediaFromVideoJobs(media, {} as any);
    expect(result.enrichedMedia).toEqual(media);
    expect(result.consumedKeys).toEqual([]);
  });

  it('normalizes annotated keys via bareVideoKey before D1 lookup', async () => {
    // Media has annotated key (ottawa/vid123), D1 stores bare key (vid123)
    const media = [
      { key: `${CITY}/vid123`, type: 'video', title: 'Annotated' },
    ];
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([
        { key: 'vid123', status: 'ready', width: 1280, height: 720, duration: 'PT10S', orientation: 'landscape', lat: null, lng: null, capturedAt: null },
      ]),
    };

    const result = await enrichMediaFromVideoJobs(media, mockDb as any);
    // Should match despite prefix difference
    expect(result.enrichedMedia[0]).toMatchObject({
      key: `${CITY}/vid123`, // key preserved as-is
      width: 1280,
      height: 720,
    });
    expect(result.consumedKeys).toEqual(['vid123']); // bare key returned
  });

  it('enriches only videos with ready jobs, leaves others unchanged', async () => {
    // 3 videos: one ready, one transcoding, one not in D1
    const media = [
      { key: 'ready-vid', type: 'video' },
      { key: 'pending-vid', type: 'video' },
      { key: 'unknown-vid', type: 'video' },
      { key: 'photo1', type: 'photo' },
    ];
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([
        { key: 'ready-vid', status: 'ready', width: 1920, height: 1080, duration: null, orientation: null, lat: null, lng: null, capturedAt: null },
        { key: 'pending-vid', status: 'transcoding', width: null, height: null, duration: null, orientation: null, lat: null, lng: null, capturedAt: null },
      ]),
    };

    const result = await enrichMediaFromVideoJobs(media, mockDb as any);
    expect(result.enrichedMedia[0]).toMatchObject({ key: 'ready-vid', width: 1920 });
    expect(result.enrichedMedia[1]).toEqual({ key: 'pending-vid', type: 'video' }); // no enrichment
    expect(result.enrichedMedia[2]).toEqual({ key: 'unknown-vid', type: 'video' }); // no enrichment
    expect(result.enrichedMedia[3]).toEqual({ key: 'photo1', type: 'photo' }); // untouched
    expect(result.consumedKeys).toEqual(['ready-vid']);
  });

  it('preserves existing fields when enriching', async () => {
    const media = [
      { key: 'vid1', type: 'video', title: 'My Video', handle: 'my-video' },
    ];
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([
        { key: 'vid1', status: 'ready', width: 640, height: 480, duration: 'PT5S', orientation: 'landscape', lat: 45.0, lng: -75.0, capturedAt: '2026-01-01' },
      ]),
    };

    const result = await enrichMediaFromVideoJobs(media, mockDb as any);
    expect(result.enrichedMedia[0]).toMatchObject({
      key: 'vid1',
      type: 'video',
      title: 'My Video',    // preserved
      handle: 'my-video',   // preserved
      width: 640,            // enriched
      lat: 45.0,             // enriched
      captured_at: '2026-01-01', // enriched (camelCase → snake_case)
    });
  });
});

describe('deleteConsumedVideoJobs', () => {
  it('does nothing when keys array is empty', async () => {
    const mockDb = { delete: vi.fn() };
    await deleteConsumedVideoJobs([], mockDb as any);
    expect(mockDb.delete).not.toHaveBeenCalled();
  });

  it('deletes rows for given keys', async () => {
    const mockWhere = vi.fn().mockResolvedValue(undefined);
    const mockDb = {
      delete: vi.fn().mockReturnValue({
        where: mockWhere,
      }),
    };
    await deleteConsumedVideoJobs(['vid1', 'vid2'], mockDb as any);
    expect(mockDb.delete).toHaveBeenCalled();
    expect(mockWhere).toHaveBeenCalled();
  });
});

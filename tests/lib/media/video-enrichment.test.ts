import { describe, it, expect, vi } from 'vitest';
import { enrichMediaFromVideoJobs, deleteConsumedVideoJobs } from '../../../src/lib/media/video-enrichment';

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

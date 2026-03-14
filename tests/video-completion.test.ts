import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockJobs: Array<{ id: number; key: string; status: string; createdAt: string }> = [];
const mockUpdates: Array<{ id: number; status: string }> = [];

vi.mock('../src/lib/get-db', () => ({
  db: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          all: () => mockJobs.filter(j => j.status === 'transcoding'),
        }),
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: (_condition: unknown) => {
          // Extract the job id from the condition — in real drizzle this is eq(videoJobs.id, id)
          // We record the update for assertion
          const id = (values as Record<string, unknown>).id;
          mockUpdates.push({ id: id as number, status: values.status as string });
          return Promise.resolve();
        },
      }),
    }),
  }),
}));

vi.mock('../src/db/schema', () => ({
  videoJobs: { status: 'status', id: 'id' },
}));

vi.mock('drizzle-orm', () => ({
  eq: (a: unknown, b: unknown) => ({ a, b }),
}));

// Mock checkVideoReady via the bucket
const mockBucketHead = vi.fn();

describe('video-completion helpers', () => {
  beforeEach(() => {
    mockJobs.length = 0;
    mockUpdates.length = 0;
    mockBucketHead.mockReset();
  });

  describe('h264OutputKey', () => {
    it('returns key/key-h264.mp4 path', async () => {
      const { h264OutputKey } = await import('../src/lib/video-completion');
      expect(h264OutputKey('abc12345')).toBe('abc12345/abc12345-h264.mp4');
    });
  });

  describe('posterKeyForVideo', () => {
    it('returns poster frame path', async () => {
      const { posterKeyForVideo } = await import('../src/lib/video-completion');
      expect(posterKeyForVideo('abc12345')).toBe('abc12345/abc12345-poster.0000000.jpg');
    });
  });

  describe('checkVideoReady', () => {
    it('returns true when H.264 output exists', async () => {
      const { checkVideoReady } = await import('../src/lib/video-completion');
      const bucket = { head: vi.fn().mockResolvedValue({ size: 123 }) };
      const result = await checkVideoReady(bucket as never, 'abc12345');
      expect(result).toBe(true);
      expect(bucket.head).toHaveBeenCalledWith('abc12345/abc12345-h264.mp4');
    });

    it('returns false when H.264 output does not exist', async () => {
      const { checkVideoReady } = await import('../src/lib/video-completion');
      const bucket = { head: vi.fn().mockResolvedValue(null) };
      const result = await checkVideoReady(bucket as never, 'abc12345');
      expect(result).toBe(false);
    });
  });

  describe('processPendingVideos', () => {
    it('marks a ready job when H.264 output exists', async () => {
      mockJobs.push({
        id: 1,
        key: 'readykey',
        status: 'transcoding',
        createdAt: new Date().toISOString(),
      });
      mockBucketHead.mockResolvedValue({ size: 100 });

      const { processPendingVideos } = await import('../src/lib/video-completion');
      const result = await processPendingVideos({
        BUCKET: { head: mockBucketHead },
      } as never);

      expect(result.processed).toBe(1);
      expect(result.ready).toBe(1);
      expect(result.failed).toBe(0);
      expect(mockBucketHead).toHaveBeenCalled();
    });

    it('marks a stale job (>2h) as failed', async () => {
      const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
      mockJobs.push({
        id: 2,
        key: 'stalekey',
        status: 'transcoding',
        createdAt: threeHoursAgo,
      });
      mockBucketHead.mockResolvedValue(null);

      const { processPendingVideos } = await import('../src/lib/video-completion');
      const result = await processPendingVideos({
        BUCKET: { head: mockBucketHead },
      } as never);

      expect(result.processed).toBe(1);
      expect(result.ready).toBe(0);
      expect(result.failed).toBe(1);
    });

    it('leaves a recent in-progress job alone', async () => {
      mockJobs.push({
        id: 3,
        key: 'recentkey',
        status: 'transcoding',
        createdAt: new Date().toISOString(),
      });
      mockBucketHead.mockResolvedValue(null);

      const { processPendingVideos } = await import('../src/lib/video-completion');
      const result = await processPendingVideos({
        BUCKET: { head: mockBucketHead },
      } as never);

      expect(result.processed).toBe(1);
      expect(result.ready).toBe(0);
      expect(result.failed).toBe(0);
    });

    it('returns zero counts when no pending jobs', async () => {
      // mockJobs is empty

      const { processPendingVideos } = await import('../src/lib/video-completion');
      const result = await processPendingVideos({
        BUCKET: { head: mockBucketHead },
      } as never);

      expect(result).toEqual({ processed: 0, ready: 0, failed: 0 });
      expect(mockBucketHead).not.toHaveBeenCalled();
    });
  });
});

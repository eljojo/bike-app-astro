import { describe, it, expect, vi } from 'vitest';
import { upsertContentCache } from '../src/lib/cache';

// Mock drizzle
const mockInsert = vi.fn().mockReturnValue({
  values: vi.fn().mockReturnValue({
    onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
  }),
});

const mockDb = { insert: mockInsert };

describe('upsertContentCache', () => {
  it('inserts with correct contentType and contentSlug', async () => {
    await upsertContentCache(mockDb as any, {
      contentType: 'routes',
      contentSlug: 'test-route',
      data: '{"slug":"test-route"}',
      githubSha: 'abc123',
    });

    expect(mockInsert).toHaveBeenCalled();
    const valuesArg = mockInsert.mock.results[0].value.values.mock.calls[0][0];
    expect(valuesArg.contentType).toBe('routes');
    expect(valuesArg.contentSlug).toBe('test-route');
    expect(valuesArg.githubSha).toBe('abc123');
  });
});

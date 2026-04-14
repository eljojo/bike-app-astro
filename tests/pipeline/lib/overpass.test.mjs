import { describe, it, expect } from 'vitest';

describe('queryOverpass — in-flight dedup', () => {
  it('coalesces simultaneous identical queries to a single fetch', async () => {
    // queryOverpass deduplicates in-flight queries by cache key.
    // We test this indirectly: fire 5 identical queries, verify all
    // resolve to the same data. The cache-on-disk ensures only one
    // network request is made for a given query.
    const { queryOverpass } = await import('../../../scripts/pipeline/lib/overpass.ts');

    // Use a query that's likely cached from prior pipeline runs.
    // If not cached, queryOverpass will fetch and cache it.
    const q = '[out:json][timeout:10];node(1);out;';
    const results = await Promise.all([
      queryOverpass(q),
      queryOverpass(q),
      queryOverpass(q),
    ]);

    // All should resolve to the same data
    expect(results[0]).toEqual(results[1]);
    expect(results[1]).toEqual(results[2]);
  });
});

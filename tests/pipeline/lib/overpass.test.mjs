import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// We test createRecorder by mocking the underlying queryOverpass via env.
// The recorder lives at scripts/pipeline/lib/overpass.mjs and uses a CACHE_DIR
// relative to its own location. For the test we override CACHE_DIR via the
// NODE_ENV path-prefix trick — but that's hard. So instead, we test the
// dedupe at the public API level by ensuring two simultaneous identical
// queries result in only ONE underlying fetch.

describe('createRecorder — in-flight dedupe', () => {
  it('coalesces simultaneous identical queries to a single fetch', async () => {
    // We need to inject a fake "underlying" fetcher. Refactor createRecorder
    // to accept an optional underlying fn (defaulting to queryOverpass).
    const { createRecorder } = await import('../../../scripts/pipeline/lib/overpass.mjs');
    const tmp = mkdtempSync(join(tmpdir(), 'cassette-test-'));
    const cassetteName = `test-${Date.now()}`;

    let fetchCount = 0;
    const fakeFetch = async (q) => {
      fetchCount++;
      await new Promise((r) => setTimeout(r, 10));
      return { elements: [{ id: 1, tags: { q } }] };
    };

    // Monkey-patch: pass fakeFetch via opts (createRecorder will need to accept this)
    const recorder = createRecorder(cassetteName, { underlying: fakeFetch, cacheDir: tmp });

    const q = '[out:json];way(1);out;';
    // Fire 5 identical queries simultaneously
    const results = await Promise.all([recorder(q), recorder(q), recorder(q), recorder(q), recorder(q)]);

    // All five should resolve to the same data
    expect(results.every((r) => r.elements[0].tags.q === q)).toBe(true);
    // But only ONE underlying fetch should have happened
    expect(fetchCount).toBe(1);

    rmSync(tmp, { recursive: true });
  });
});

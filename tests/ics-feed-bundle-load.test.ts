import { describe, test, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Regression test for production crash:
 *
 *   TypeError: e.BigInt is not a function
 *     at requireDist$1 (chunks/ics-feed.server_*.mjs)
 *     at requireDist (… node-ical → rrule-temporal → @js-temporal/polyfill)
 *
 * `node-ical` pulls in `@js-temporal/polyfill@0.5.x` (its in-package
 * `overrides` to redirect to `temporal-polyfill` is silently ignored —
 * `overrides` only takes effect in the root `package.json`). That polyfill
 * depends on `jsbi`, whose source does `module.exports = JSBI` (a class with
 * static methods). On the Workers runtime the bundled CJS does
 * `var e = require('jsbi'); e.BigInt(0)` — but Astro/Rollup wraps the
 * imported namespace via `getAugmentedNamespace`, which exposes only
 * `default` and `__esModule`, NOT static methods on the default-exported
 * class. Result: `e.BigInt` is undefined and module init throws.
 *
 * The Node CJS loader normally avoids this wrapper, so the source-level
 * tests in `tests/ics-feed-*.test.ts` all pass even when the production
 * bundle is broken. To catch the regression we must load the actual
 * bundled chunk and run `parseIcs` against it.
 *
 * Test runs only when `dist/server/chunks/` exists (i.e. after a build).
 * Wire it into CI by running `npm run build` (or `make build`) before
 * `vitest`. Without dist the `describe` block reports as skipped — visible
 * in vitest output, doesn't fail the suite.
 */

const projectRoot = path.resolve(fileURLToPath(import.meta.url), '..', '..');
const chunksDir = path.join(projectRoot, 'dist', 'server', 'chunks');
const distExists = existsSync(chunksDir);

describe.skipIf(!distExists)('built ics-feed chunk loads on a Node-like runtime', () => {
  test('parseIcs in the bundled chunk does not throw on module init', async () => {
    const matches = readdirSync(chunksDir).filter(f => /^ics-feed\.server_.*\.mjs$/.test(f));
    expect(matches, 'expected exactly one ics-feed.server chunk').toHaveLength(1);

    const chunkPath = path.join(chunksDir, matches[0]);
    const mod = await import(chunkPath);
    expect(typeof mod.parseIcs, 'bundle must export parseIcs').toBe('function');

    // A weekly RRULE with UNTIL is enough to drive the requireDist$1 path
    // (rrule-temporal → @js-temporal/polyfill → jsbi static methods).
    // If the bundle wrapper drops static methods we throw at module init,
    // before this line; if it returns successfully, the wrapper survived.
    const text = readFileSync(path.join(projectRoot, 'tests/fixtures/ics/series-weekly-until.ics'), 'utf-8');
    const feed = mod.parseIcs(text, 'https://example.test/');
    expect(feed.events.length).toBeGreaterThan(0);
    expect(feed.events[0].uid).toBe('test-weekly@example.com');
  });
});

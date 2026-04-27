import { describe, test, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Build smoke test: load the bundled `ics-feed.server_*.mjs` chunk and
 * exercise parseIcs against a fixture.
 *
 * History: this test was added when `node-ical` pulled in jsbi via
 * `@js-temporal/polyfill@0.5.x`; Astro/Rollup's CJS namespace wrapping
 * stripped jsbi's static methods, so `e.BigInt(0)` threw at module init
 * in the production bundle while every source-level test passed on Node.
 *
 * That bug class is gone — ical.js is pure-JS and ships no jsbi dependency.
 * The test stays because "the build produced a loadable chunk that can run
 * parseIcs end-to-end" is still worth verifying after any bundling change.
 *
 * Test runs only when `dist/server/chunks/` exists (i.e. after a build).
 * Wire it into CI by running `npm run build` (or `make build`) before
 * `vitest`. Without dist the `describe` block reports as skipped.
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
    const feed = mod.parseIcs(text, 'https://example.test/', 'America/Toronto');
    expect(feed.events.length).toBeGreaterThan(0);
    expect(feed.events[0].uid).toBe('test-weekly@example.com');
  });
});

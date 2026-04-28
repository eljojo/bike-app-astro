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

/**
 * Locate `parseIcs` in the bundled chunk's exports. Rollup may expose it as
 * a top-level export OR (when the chunk wraps the module via namespace
 * imports — e.g. when a callsite does `await import('...').then(({...}) =>`)
 * inside a frozen `icsFeed_server` namespace whose alias is minified to a
 * single letter. Walk both shapes so a future bundler change doesn't break
 * this smoke test.
 */
function findExportedFn(mod: Record<string, unknown>, name: string): ((...args: unknown[]) => unknown) | undefined {
  const direct = mod[name];
  if (typeof direct === 'function') return direct as (...args: unknown[]) => unknown;
  for (const v of Object.values(mod)) {
    if (v && typeof v === 'object') {
      const nested = (v as Record<string, unknown>)[name];
      if (typeof nested === 'function') return nested as (...args: unknown[]) => unknown;
    }
  }
  return undefined;
}

describe.skipIf(!distExists)('built ics-feed chunk loads on a Node-like runtime', () => {
  test('parseIcs in the bundled chunk does not throw on module init', async () => {
    const matches = readdirSync(chunksDir).filter(f => /^ics-feed\.server_.*\.mjs$/.test(f));
    expect(matches, 'expected exactly one ics-feed.server chunk').toHaveLength(1);

    const chunkPath = path.join(chunksDir, matches[0]);
    const mod = await import(chunkPath);
    const parseIcs = findExportedFn(mod as Record<string, unknown>, 'parseIcs');
    expect(parseIcs, 'bundle must export parseIcs (directly or via namespace)').toBeTypeOf('function');

    // Any RRULE-bearing fixture exercises the parse path end-to-end. If the
    // bundled chunk had a module-init failure we'd have thrown at the import
    // above; reaching this point means the build is loadable.
    const text = readFileSync(path.join(projectRoot, 'tests/fixtures/ics/series-weekly-until.ics'), 'utf-8');
    const feed = parseIcs!(text, 'https://example.test/', 'America/Toronto') as { events: Array<{ uid: string }> };
    expect(feed.events.length).toBeGreaterThan(0);
    expect(feed.events[0].uid).toBe('test-weekly@example.com');
  });
});

import path from 'node:path';

export const CONTENT_DIR = process.env.CONTENT_DIR || path.resolve('..', 'bike-routes');

/**
 * City slug for this instance.
 *
 * At build time: read from process.env.CITY (set by shell or wheretoBike() options).
 * In bundled Worker: inlined as a string literal via Vite define (__CITY__).
 *
 * Never defaults silently — an unset CITY would commit content to the wrong
 * directory in the data repo (the bug that prompted this safeguard).
 */
function resolveCity(): string {
  // In the Vite-bundled server, __CITY__ is replaced with a string literal at build time.
  // In Node.js (loaders, tests, scripts), it's undefined and we fall back to process.env.
  if (typeof __CITY__ !== 'undefined') return __CITY__;
  const fromEnv = process.env.CITY;
  if (fromEnv) return fromEnv;
  throw new Error(
    'CITY environment variable is required. Set CITY=ottawa (or blog, demo, etc.) before building or running.',
  );
}

export const CITY: string = resolveCity();
export const cityDir = path.join(CONTENT_DIR, CITY);

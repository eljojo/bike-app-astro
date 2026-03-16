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

/**
 * Video storage prefix — the S3/R2 path prefix for this instance's videos.
 *
 * Defaults to CITY (e.g. "ottawa"). Override with VIDEO_PREFIX env var to
 * isolate environments: "ottawa-staging" keeps staging videos separate from
 * production while sharing the same bucket and CDN.
 *
 * The Lambda webhook map is keyed by this prefix, so each value must have
 * a corresponding entry in the Lambda's WEBHOOK_MAP.
 */
function resolveVideoPrefix(): string {
  if (typeof __VIDEO_PREFIX__ !== 'undefined') return __VIDEO_PREFIX__;
  return process.env.VIDEO_PREFIX || CITY;
}

export const VIDEO_PREFIX: string = resolveVideoPrefix();

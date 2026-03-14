/**
 * Lightweight env reader for CSP upload origins.
 *
 * Separated from env.ts because env.ts has top-level await (DB init,
 * storage setup) that silently kills Astro's prerender step when
 * imported from middleware. This file has NO top-level side effects —
 * the cloudflare:workers import happens lazily inside getCspEnv(),
 * which is only called at request time for SSR pages.
 *
 * Vendor isolation: this is one of two files that import cloudflare:workers
 * (the other being env.ts). Each serves a different concern — env.ts for
 * the full app environment, this for CSP-only values in middleware.
 */
import type { AppEnv } from './app-env';

export interface CspUploadEnv {
  r2AccountId: string;
  s3OriginalsBucket?: string;
  mediaconvertRegion?: string;
}

function requireEnv(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  if (typeof value !== 'string' || value === '') {
    throw new Error(
      `Missing required env var: ${key}. ` +
      'CSP upload origins need this to build exact connect-src directives. ' +
      'Check wrangler secrets / .env file.',
    );
  }
  return value;
}

/** Read R2/S3 env values for CSP connect-src origins.
 * Local dev: process.env (populated by dotenv).
 * Cloudflare Workers: platform bindings via cloudflare:workers.
 *
 * Returns null during prerendering (no runtime env available — expected).
 * Throws if R2_ACCOUNT_ID is missing at request time — a silent fallback
 * here led to CSP directives quietly dropping upload origins on staging. */
export async function getCspEnv(): Promise<CspUploadEnv | null> {
  // Local dev: dotenv populates process.env with .env values
  if (process.env.R2_ACCOUNT_ID) {
    return {
      r2AccountId: requireEnv(process.env, 'R2_ACCOUNT_ID'),
      s3OriginalsBucket: process.env.S3_ORIGINALS_BUCKET || undefined,
      mediaconvertRegion: process.env.MEDIACONVERT_REGION || undefined,
    };
  }

  // Cloudflare Workers: secrets are only available via platform bindings
  let appEnv: AppEnv;
  try {
    const { env } = await import('cloudflare:workers');
    appEnv = env as AppEnv;
  } catch {
    // Not in Workers runtime (e.g. prerendering in Node.js).
    // Expected — applyNonceCsp only runs for SSR pages, never prerendered.
    return null;
  }

  return {
    r2AccountId: requireEnv(appEnv as unknown as Record<string, unknown>, 'R2_ACCOUNT_ID'),
    s3OriginalsBucket: appEnv.S3_ORIGINALS_BUCKET || undefined,
    mediaconvertRegion: appEnv.MEDIACONVERT_REGION || undefined,
  };
}

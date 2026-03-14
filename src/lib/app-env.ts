import type { BucketLike } from './storage';

/**
 * Unified environment interface for both Cloudflare and local runtimes.
 * This is the ONLY place env shape is defined — both env.ts and env-local.ts must satisfy it.
 */
export interface AppEnv {
  DB: unknown; // D1Database in prod, drizzle Database locally — typed at usage via get-db.ts
  BUCKET: BucketLike;
  ASSETS: unknown;
  GITHUB_TOKEN: string;
  WEBAUTHN_RP_ID?: string;
  WEBAUTHN_RP_NAME?: string;
  WEBAUTHN_ORIGIN?: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  R2_ACCOUNT_ID: string;
  R2_BUCKET_NAME: string;
  R2_PUBLIC_URL: string;
  STORAGE_KEY_PREFIX: string;
  GIT_OWNER: string;
  GIT_DATA_REPO: string;
  GIT_BRANCH: string;
  ENVIRONMENT: string;
  RWGPS_API_KEY?: string;
  RWGPS_AUTH_TOKEN?: string;
  GOOGLE_PLACES_API_KEY?: string;
  THUNDERFOREST_API_KEY?: string;
  TILE_CACHE?: unknown; // KV namespace in prod, undefined locally (handled by env-local)
  AI?: unknown; // Workers AI binding, used for poster vision extraction
  SES_ACCESS_KEY_ID?: string;
  SES_SECRET_ACCESS_KEY?: string;
  SES_REGION?: string;
  SES_FROM?: string;
  STRAVA_CLIENT_ID?: string;
  STRAVA_CLIENT_SECRET?: string;
  // Video transcoding (AWS MediaConvert — endpoint auto-discovered)
  MEDIACONVERT_QUEUE?: string;
  MEDIACONVERT_ROLE?: string;
  MEDIACONVERT_ACCESS_KEY_ID?: string;
  MEDIACONVERT_SECRET_ACCESS_KEY?: string;
  MEDIACONVERT_REGION?: string;
  S3_ORIGINALS_BUCKET?: string;
  S3_OUTPUTS_BUCKET?: string;
  CRON_SECRET?: string;
}

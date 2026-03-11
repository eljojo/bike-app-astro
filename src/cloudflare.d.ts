/**
 * Ambient module declaration for cloudflare:workers.
 *
 * This must be in a file with NO top-level imports/exports so TypeScript
 * treats it as an ambient declaration (creating the module) rather than
 * module augmentation (which requires the module to already exist).
 *
 * The global types it references (D1Database, R2Bucket, etc.) are
 * declared in env.d.ts.
 */
declare module 'cloudflare:workers' {
  interface Env {
    DB: D1Database;
    BUCKET: R2Bucket;
    ASSETS: Fetcher;
    GITHUB_TOKEN: string;
    WEBAUTHN_RP_ID?: string;
    WEBAUTHN_RP_NAME?: string;
    WEBAUTHN_ORIGIN?: string;
    R2_ACCESS_KEY_ID: string;
    R2_SECRET_ACCESS_KEY: string;
    R2_ACCOUNT_ID: string;
    R2_BUCKET_NAME: string;
    R2_PUBLIC_URL: string;
    STORAGE_KEY_PREFIX?: string;
    GIT_BRANCH?: string;
    ENVIRONMENT?: string;
  }
  export const env: Env;
}

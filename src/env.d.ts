/// <reference types="astro/client" />

import type { SessionUser } from './lib/auth';

declare namespace App {
  interface Locals {
    runtime: {
      env: {
        DB: D1Database;
        R2: R2Bucket;
        ASSETS: Fetcher;
        GITHUB_TOKEN: string;
        WEBAUTHN_RP_ID: string;
        WEBAUTHN_RP_NAME: string;
        WEBAUTHN_ORIGIN: string;
        R2_ACCESS_KEY_ID: string;
        R2_SECRET_ACCESS_KEY: string;
        R2_ACCOUNT_ID: string;
        R2_BUCKET_NAME: string;
      };
    };
    user?: SessionUser;
  }
}

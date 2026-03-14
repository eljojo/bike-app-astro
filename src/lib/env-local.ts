import path from 'node:path';
import { createLocalDb, openLocalDb } from '../db/local';
import { createLocalBucket } from './storage-local';
import { createLocalTileCache } from './tile-cache/tile-cache.adapter-local';
import type { AppEnv } from './app-env';

const LOCAL_DB_PATH = path.resolve(import.meta.dirname, '..', '..', '.data', 'local.db');
const LOCAL_UPLOADS_DIR = path.resolve(import.meta.dirname, '..', '..', '.data', 'uploads');
const LOCAL_TILE_CACHE_DIR = path.resolve(import.meta.dirname, '..', '..', '.data', 'tile-cache');

export { openLocalDb };

export function createLocalEnv(): AppEnv {
  const db = createLocalDb(process.env.LOCAL_DB_PATH || LOCAL_DB_PATH);
  const bucket = createLocalBucket(process.env.LOCAL_UPLOADS_DIR || LOCAL_UPLOADS_DIR);

  return {
    DB: db,
    BUCKET: bucket,
    GITHUB_TOKEN: process.env.GITHUB_TOKEN || '',
    WEBAUTHN_RP_ID: process.env.WEBAUTHN_RP_ID,
    WEBAUTHN_RP_NAME: process.env.WEBAUTHN_RP_NAME,
    WEBAUTHN_ORIGIN: process.env.WEBAUTHN_ORIGIN,
    R2_ACCESS_KEY_ID: '',
    R2_SECRET_ACCESS_KEY: '',
    R2_ACCOUNT_ID: '',
    R2_BUCKET_NAME: '',
    R2_PUBLIC_URL: process.env.R2_PUBLIC_URL || 'http://localhost:4321/dev-uploads',
    STORAGE_KEY_PREFIX: process.env.STORAGE_KEY_PREFIX || '',
    GIT_OWNER: process.env.GIT_OWNER || 'eljojo',
    GIT_DATA_REPO: process.env.GIT_DATA_REPO || 'bike-routes',
    GIT_BRANCH: process.env.GIT_BRANCH || '',
    ENVIRONMENT: process.env.ENVIRONMENT || 'local',
    RWGPS_API_KEY: process.env.RWGPS_API_KEY || '',
    RWGPS_AUTH_TOKEN: process.env.RWGPS_AUTH_TOKEN || '',
    THUNDERFOREST_API_KEY: process.env.THUNDERFOREST_API_KEY || '',
    ASSETS: null as unknown,
    SES_ACCESS_KEY_ID: process.env.SES_ACCESS_KEY_ID,
    SES_SECRET_ACCESS_KEY: process.env.SES_SECRET_ACCESS_KEY,
    SES_REGION: process.env.SES_REGION,
    SES_FROM: process.env.SES_FROM || 'noreply@localhost',
    STRAVA_CLIENT_ID: process.env.STRAVA_CLIENT_ID,
    STRAVA_CLIENT_SECRET: process.env.STRAVA_CLIENT_SECRET,
    // Video transcoding — local dev uses no-op adapter, these are unused
    MEDIACONVERT_QUEUE: '',
    MEDIACONVERT_ROLE: '',
    MEDIACONVERT_ACCESS_KEY_ID: '',
    MEDIACONVERT_SECRET_ACCESS_KEY: '',
    MEDIACONVERT_REGION: '',
    S3_ORIGINALS_BUCKET: '',
    S3_OUTPUTS_BUCKET: '',
    CRON_SECRET: process.env.CRON_SECRET || '',
  };
}

export function createLocalTileCacheFromEnv() {
  return createLocalTileCache(LOCAL_TILE_CACHE_DIR);
}

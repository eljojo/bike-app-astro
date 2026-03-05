import path from 'node:path';
import { createLocalDb } from '../db/local';
import { createLocalBucket } from './storage-local';
import type { AppEnv } from './app-env';

const LOCAL_DB_PATH = path.resolve(import.meta.dirname, '..', '..', '.data', 'local.db');
const LOCAL_UPLOADS_DIR = path.resolve(import.meta.dirname, '..', '..', '.data', 'uploads');

export function createLocalEnv(): AppEnv {
  const db = createLocalDb(process.env.LOCAL_DB_PATH || LOCAL_DB_PATH);
  const bucket = createLocalBucket(process.env.LOCAL_UPLOADS_DIR || LOCAL_UPLOADS_DIR);

  return {
    DB: db,
    BUCKET: bucket,
    GITHUB_TOKEN: process.env.GITHUB_TOKEN || '',
    WEBAUTHN_RP_ID: process.env.WEBAUTHN_RP_ID || 'localhost',
    WEBAUTHN_RP_NAME: process.env.WEBAUTHN_RP_NAME || 'whereto-bike',
    WEBAUTHN_ORIGIN: process.env.WEBAUTHN_ORIGIN || 'http://localhost:4321',
    R2_ACCESS_KEY_ID: '',
    R2_SECRET_ACCESS_KEY: '',
    R2_ACCOUNT_ID: '',
    R2_BUCKET_NAME: '',
    R2_PUBLIC_URL: process.env.R2_PUBLIC_URL || 'http://localhost:4321/dev-uploads',
    STORAGE_KEY_PREFIX: process.env.STORAGE_KEY_PREFIX || '',
    GIT_BRANCH: process.env.GIT_BRANCH || '',
    ENVIRONMENT: process.env.ENVIRONMENT || 'local',
    RWGPS_API_KEY: process.env.RWGPS_API_KEY || '',
    ASSETS: null as unknown,
  };
}

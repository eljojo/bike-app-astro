/**
 * Platform environment bindings.
 *
 * This is the ONLY file that imports from 'cloudflare:workers'.
 * Everything else imports from here. If the platform changes,
 * only this file needs to be updated.
 *
 * When RUNTIME=local (dev mode), we use local implementations
 * instead of Cloudflare bindings — local SQLite, local filesystem,
 * local git.
 */

import type { AppEnv } from './app-env';

let _env: AppEnv;
let _openLocalDb: ((path: string) => unknown) | undefined;
let _localDbPath: string | undefined;

if (process.env.RUNTIME === 'local') {
  const { createLocalEnv, openLocalDb } = await import('./env-local');
  _env = createLocalEnv();
  _openLocalDb = openLocalDb;
  _localDbPath = (_env.DB as any).$client.name;
} else {
  const cf = await import('cloudflare:workers');
  _env = cf.env as AppEnv;
}

export const env: AppEnv = _env;
export const openLocalDb = _openLocalDb;
export const localDbPath = _localDbPath;

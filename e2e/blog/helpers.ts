/**
 * Blog test helpers — thin wrapper around shared helpers bound to blog DB.
 */
import { DB_PATH } from './fixture-setup.ts';
import {
  seedSession as _seedSession,
  loginAs,
  cleanupSession as _cleanupSession,
  clearContentEdits as _clearContentEdits,
  proxyTiles,
  type SeedOptions,
} from '../shared-helpers.ts';

export const seedSession = (opts?: SeedOptions) => _seedSession(DB_PATH, opts);
export const cleanupSession = (token: string) => _cleanupSession(DB_PATH, token);
export const clearContentEdits = (contentType: string, slug: string) => _clearContentEdits(DB_PATH, contentType, slug);
export { loginAs, proxyTiles };

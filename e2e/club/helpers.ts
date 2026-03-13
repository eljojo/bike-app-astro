/**
 * Club test helpers — thin wrapper around shared helpers bound to club DB,
 * plus club-specific fixture restoration functions.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { DB_PATH, FIXTURE_DIR } from './fixture-setup.ts';
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

// --- Club-specific fixture helpers ---

/** Get the root commit SHA of the fixture repo (the "initial fixture" commit). */
let rootCommit: string | undefined;
function getFixtureRootCommit(): string {
  if (!rootCommit) {
    rootCommit = execSync('git rev-list --max-parents=0 HEAD', {
      cwd: FIXTURE_DIR, encoding: 'utf-8',
    }).trim();
  }
  return rootCommit;
}

/**
 * Restore fixture files to their initial state from the root commit.
 *
 * Uses `git show` (read-only, no index lock needed) to read the original
 * content and writes it back to disk via fs. This avoids git index lock
 * contention with concurrent workers and the server's git mutex.
 */
export function restoreFixtureFiles(paths: string[]) {
  const root = getFixtureRootCommit();
  for (const relPath of paths) {
    try {
      const content = execSync(`git show ${root}:"${relPath}"`, {
        cwd: FIXTURE_DIR, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
      });
      fs.writeFileSync(path.join(FIXTURE_DIR, relPath), content, 'utf-8');
    } catch {
      // File might not exist in root commit — nothing to restore.
    }
  }
}

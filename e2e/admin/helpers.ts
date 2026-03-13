/**
 * Admin test helpers — thin wrapper around shared helpers bound to admin DB,
 * plus admin-specific fixture restoration functions.
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

// --- Admin-only helpers below ---

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
 * Remove files/dirs created by a previous test attempt so retries start clean.
 * Only touches the filesystem — no git operations needed since the server's
 * LocalGitService reads from disk, not from git objects.
 */
export function cleanupCreatedFiles(paths: string[]) {
  for (const relPath of paths) {
    const fullPath = path.join(FIXTURE_DIR, relPath);
    if (fs.existsSync(fullPath)) {
      fs.rmSync(fullPath, { recursive: true });
    }
  }
}

/**
 * Restore fixture files to their initial state from the root commit.
 *
 * Uses `git show` (read-only, no index lock needed) to read the original
 * content and writes it back to disk via fs. This avoids git index lock
 * contention with concurrent workers and the server's git mutex.
 *
 * Works because LocalGitService.readFile() reads from the filesystem,
 * not from git objects — so restoring the file content on disk is sufficient.
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

/**
 * Delete a file if it exists. No git operations — the server reads
 * from disk, so removing the file is sufficient.
 */
export function deleteFixtureFile(relPath: string) {
  const fullPath = path.join(FIXTURE_DIR, relPath);
  if (fs.existsSync(fullPath)) {
    try { fs.unlinkSync(fullPath); } catch {}
  }
}

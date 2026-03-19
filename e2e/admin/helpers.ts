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
  getContentEdit as _getContentEdit,
  seedContentEdit as _seedContentEdit,
  proxyTiles,
  type SeedOptions,
} from '../shared-helpers.ts';

export const seedSession = (opts?: SeedOptions) => _seedSession(DB_PATH, opts);
export const cleanupSession = (token: string) => _cleanupSession(DB_PATH, token);
export const clearContentEdits = (contentType: string, slug: string) => _clearContentEdits(DB_PATH, contentType, slug);
export const getContentEdit = (contentType: string, slug: string) => _getContentEdit(DB_PATH, contentType, slug);
export const seedContentEdit = (contentType: string, slug: string, data: string) => _seedContentEdit(DB_PATH, contentType, slug, data);
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
 * Remove files/dirs created by a previous test run so retries start clean.
 *
 * Deletes from the filesystem AND removes from the git index. The git
 * index cleanup is critical: LocalGitService.writeFiles() uses
 * `git add` + `git diff --cached` to detect changes. If a file was
 * committed in a prior test run and then deleted from disk without
 * removing it from the index, `git add` on identical content is a no-op
 * and no commit happens — causing tests to fail with "HEAD unchanged".
 */
export function cleanupCreatedFiles(paths: string[]) {
  for (const relPath of paths) {
    const fullPath = path.join(FIXTURE_DIR, relPath);
    if (fs.existsSync(fullPath)) {
      fs.rmSync(fullPath, { recursive: true });
    }
  }
  // Remove from git index so the next `git add` treats them as new.
  // Uses `--ignore-unmatch` so it's safe if the files aren't tracked.
  try {
    execSync(`git rm --cached --ignore-unmatch ${paths.map(p => `"${p}"`).join(' ')}`, {
      cwd: FIXTURE_DIR, stdio: 'pipe',
    });
  } catch {
    // Ignore errors — files may not be tracked
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

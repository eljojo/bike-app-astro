/**
 * Shared helper for committing GPX files.
 *
 * In production (GITHUB_TOKEN present), uploads content to Git LFS
 * and returns a pointer file. Locally, returns raw GPX content
 * because local git handles LFS via .gitattributes.
 */

import type { FileChange } from './git-service';
import { uploadToLfs } from './git-lfs';

export async function commitGpxFile(opts: {
  path: string;
  content: string;
  token: string | undefined;
  owner: string;
  repo: string;
}): Promise<FileChange> {
  if (opts.token && typeof opts.token === 'string') {
    const pointer = await uploadToLfs(opts.token, opts.owner, opts.repo, opts.content);
    return { path: opts.path, content: pointer };
  }
  // Local dev: commit raw GPX (local git handles LFS via .gitattributes)
  return { path: opts.path, content: opts.content };
}

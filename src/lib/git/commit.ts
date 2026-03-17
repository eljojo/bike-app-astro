import type { FileChange, CommitAuthor, IGitService } from './git.adapter-github';
import { createGitService } from './git-factory';
import { env } from '../env/env.service';

/**
 * Append system-level trailers to a commit message.
 * Idempotent — won't duplicate trailers already present.
 *
 * Exported for testing. Application code should use commitToContentRepo().
 */
export function appendSystemTrailers(message: string): string {
  const appBranch: string = typeof __APP_BRANCH__ !== 'undefined' ? __APP_BRANCH__ : 'unknown';
  if (env.ENVIRONMENT === 'staging' && appBranch !== 'main' && !message.includes('App-Branch:')) {
    message += `\nApp-Branch: ${appBranch}`;
  }
  return message;
}

/**
 * Commit files to the content repo. Appends system-level trailers
 * (App-Branch on staging) to the caller's message automatically.
 *
 * Callers own their message content. This function owns the system metadata.
 */
export async function commitToContentRepo(
  message: string,
  files: FileChange[],
  author: CommitAuthor,
  git?: IGitService,
  deletePaths?: string[],
): Promise<string> {
  const decorated = appendSystemTrailers(message);
  const service = git ?? createGitService({
    token: env.GITHUB_TOKEN,
    owner: env.GIT_OWNER,
    repo: env.GIT_DATA_REPO,
    branch: env.GIT_BRANCH || 'main',
  });
  return service.writeFiles(files, decorated, author, deletePaths);
}

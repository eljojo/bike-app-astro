import type { GitServiceConfig, IGitService } from './git.adapter-github';
import { GitService } from './git.adapter-github';
import { LocalGitService } from './git.adapter-local';
import { CONTENT_DIR } from '../config/config.server';

/**
 * Create the appropriate git service based on runtime.
 * Local mode uses simple-git on the local bike-routes checkout.
 * Production uses the GitHub REST API.
 */
export function createGitService(config: GitServiceConfig): IGitService {
  if (process.env.RUNTIME === 'local') {
    return new LocalGitService(CONTENT_DIR, config.branch);
  }
  return new GitService(config);
}

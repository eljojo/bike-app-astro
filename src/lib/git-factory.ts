import type { GitServiceConfig, IGitService } from './git-service';
import { GitService } from './git-service';
import { LocalGitService } from './git-service-local';
import { CONTENT_DIR } from './config';

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

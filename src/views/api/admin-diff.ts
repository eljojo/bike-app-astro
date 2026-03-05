import type { APIContext } from 'astro';
import { env } from '../../lib/env';
import { createGitService } from '../../lib/git-factory';
import { GIT_OWNER, GIT_DATA_REPO } from '../../lib/config';
import { requireAdmin } from '../../lib/auth';
import { jsonResponse, jsonError } from '../../lib/api-response';

export const prerender = false;

export async function POST({ request, locals }: APIContext) {
  try {
    requireAdmin(locals.user);
  } catch {
    return jsonError('Unauthorized', 401);
  }

  const { commitSha, contentPath } = await request.json();
  if (!commitSha) {
    return jsonError('Missing commitSha');
  }

  const git = createGitService({
    token: env.GITHUB_TOKEN,
    owner: GIT_OWNER,
    repo: GIT_DATA_REPO,
    branch: env.GIT_BRANCH || 'main',
  });

  try {
    const diff = await git.getCommitDiff(commitSha, contentPath);
    return jsonResponse({ diff: diff || 'No changes found' });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to get diff';
    return jsonError(message, 500);
  }
}

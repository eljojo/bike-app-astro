import type { APIContext } from 'astro';
import { env } from '../../lib/env/env.service';
import { createGitService } from '../../lib/git/git-factory';
import { authorize } from '../../lib/auth/authorize';
import { jsonResponse, jsonError } from '../../lib/api-response';

export const prerender = false;

export async function POST({ request, locals }: APIContext) {
  const user = authorize(locals, 'view-history');
  if (user instanceof Response) return user;

  const { commitSha, contentPath } = await request.json();
  if (!commitSha) {
    return jsonError('Missing commitSha');
  }

  const git = createGitService({
    token: env.GITHUB_TOKEN,
    owner: env.GIT_OWNER,
    repo: env.GIT_DATA_REPO,
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

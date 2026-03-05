import type { APIContext } from 'astro';
import { env } from '../../lib/env';
import { createGitService } from '../../lib/git-factory';
import { db } from '../../lib/get-db';
import { contentEdits } from '../../db/schema';
import { GIT_OWNER, GIT_DATA_REPO } from '../../lib/config';
import { requireAdmin } from '../../lib/auth';
import { jsonResponse, jsonError } from '../../lib/api-response';

export const prerender = false;

export async function POST({ locals }: APIContext) {
  // Guard: only available on staging
  if (env.ENVIRONMENT !== 'staging') {
    return jsonError('Only available on staging', 403);
  }

  // Guard: admin access required
  try {
    requireAdmin(locals.user);
  } catch {
    return jsonError('Unauthorized', 401);
  }

  try {
    const git = createGitService({
      token: env.GITHUB_TOKEN,
      owner: GIT_OWNER,
      repo: GIT_DATA_REPO,
      branch: 'staging',
    });

    // 1. Get main's commit SHA
    const mainSha = await git.getRef('main');
    if (!mainSha) {
      return jsonError('Could not find main branch', 500);
    }

    // 2. Check if staging branch exists
    const stagingSha = await git.getRef('staging');

    // 3/4. Update or create staging branch
    if (stagingSha !== null) {
      await git.updateRef('staging', mainSha, true);
    } else {
      await git.createRef('staging', mainSha);
    }

    // 5. Clear D1 scratchpad
    const database = db();
    await database.delete(contentEdits);

    // Staging rebuild is triggered automatically by GitHub Actions in bike-routes
    // (notify-astro.yml) when the staging ref is updated.

    return jsonResponse({ success: true, sha: mainSha });
  } catch (err: unknown) {
    console.error('sync error:', err);
    const message = err instanceof Error ? err.message : 'Failed to sync';
    return jsonError(message, 500);
  }
}

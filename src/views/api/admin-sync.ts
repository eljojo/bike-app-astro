import type { APIContext } from 'astro';
import { env } from '../../lib/env/env.service';
import { createGitService } from '../../lib/git/git-factory';
import { db } from '../../lib/get-db';
import { contentEdits } from '../../db/schema';
import { eq } from 'drizzle-orm';
import { CITY } from '../../lib/config/config';
import { authorize } from '../../lib/auth/authorize';
import { jsonResponse, jsonError } from '../../lib/api-response';

export const prerender = false;

export async function POST({ locals }: APIContext) {
  // Guard: only available on staging
  if (env.ENVIRONMENT !== 'staging') {
    return jsonError('Only available on staging', 403);
  }

  // Guard: admin access required
  const user = authorize(locals, 'sync-staging');
  if (user instanceof Response) return user;

  try {
    const git = createGitService({
      token: env.GITHUB_TOKEN,
      owner: env.GIT_OWNER,
      repo: env.GIT_DATA_REPO,
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

    // 5. Clear D1 scratchpad for this city
    const database = db();
    await database.delete(contentEdits).where(eq(contentEdits.city, CITY));

    // Staging rebuild is triggered automatically by GitHub Actions in bike-routes
    // (notify-astro.yml) when the staging ref is updated.

    return jsonResponse({ success: true, sha: mainSha });
  } catch (err: unknown) {
    console.error('sync error:', err);
    const message = err instanceof Error ? err.message : 'Failed to sync';
    return jsonError(message, 500);
  }
}

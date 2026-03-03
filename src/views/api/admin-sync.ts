import type { APIContext } from 'astro';
import { env } from '../../lib/env';
import { createGitService } from '../../lib/git-factory';
import { db } from '../../lib/get-db';
import { contentEdits } from '../../db/schema';
import { GIT_OWNER, GIT_DATA_REPO } from '../../lib/config';

export const prerender = false;

export async function POST({ locals }: APIContext) {
  // Guard: only available on staging
  if (env.ENVIRONMENT !== 'staging') {
    return new Response(JSON.stringify({ error: 'Only available on staging' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Guard: admin access required
  const user = locals.user;
  if (!user || user.role !== 'admin') {
    return new Response(JSON.stringify({ error: 'Admin access required' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
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
      return new Response(JSON.stringify({ error: 'Could not find main branch' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
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

    return new Response(JSON.stringify({ success: true, sha: mainSha }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('sync error:', err);
    return new Response(JSON.stringify({ error: err.message || 'Failed to sync' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

import type { APIContext } from 'astro';
import { env } from '../../lib/env';
import { GitService } from '../../lib/git-service';
import { getDb } from '../../db';
import { routeEdits } from '../../db/schema';

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
    const git = new GitService({
      token: env.GITHUB_TOKEN,
      owner: 'eljojo',
      repo: 'bike-routes',
      branch: 'staging',
    });

    console.log('sync: token length:', env.GITHUB_TOKEN?.length ?? 'undefined');

    // 1. Get main's commit SHA
    console.log('sync: step 1 — getting main ref');
    const mainSha = await git.getRef('main');
    if (!mainSha) {
      return new Response(JSON.stringify({ error: 'Could not find main branch' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    console.log('sync: step 1 done, main sha:', mainSha.slice(0, 8));

    // 2. Check if staging branch exists
    console.log('sync: step 2 — checking staging ref');
    const stagingSha = await git.getRef('staging');
    console.log('sync: step 2 done, staging exists:', stagingSha !== null);

    // 3/4. Update or create staging branch
    if (stagingSha !== null) {
      console.log('sync: step 3 — updating staging ref');
      await git.updateRef('staging', mainSha, true);
    } else {
      console.log('sync: step 4 — creating staging ref');
      await git.createRef('staging', mainSha);
    }
    console.log('sync: step 3/4 done');

    // 5. Clear D1 scratchpad
    console.log('sync: step 5 — clearing scratchpad');
    const db = getDb(env.DB);
    await db.delete(routeEdits);
    console.log('sync: step 5 done');

    // 6. Trigger staging rebuild
    console.log('sync: step 6 — triggering rebuild');
    await git.triggerRebuild();
    console.log('sync: step 6 done');

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

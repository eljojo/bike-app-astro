import type { APIContext } from 'astro';
import { env } from '../../../lib/env';
import { db } from '../../../lib/get-db';
import { findDraft, deleteDraft } from '../../../lib/draft-service';
import { createGitService } from '../../../lib/git-factory';

export const prerender = false;

export async function POST({ request, locals }: APIContext) {
  const user = locals.user;
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    });
  }

  const { contentType, contentSlug } = await request.json();
  const database = db();
  const draft = await findDraft(database, user.id, contentType, contentSlug);

  if (!draft) {
    return new Response(JSON.stringify({ error: 'No draft found' }), {
      status: 404, headers: { 'Content-Type': 'application/json' },
    });
  }

  const baseBranch = env.GIT_BRANCH || 'main';
  const git = createGitService({
    token: env.GITHUB_TOKEN, owner: 'eljojo', repo: 'bike-routes', branch: baseBranch,
  });

  // Close PR if it exists
  if (draft.prNumber) {
    try { await git.closePullRequest(draft.prNumber); } catch { /* PR may already be closed */ }
  }

  // Delete branch
  try { await git.deleteRef(draft.branchName); } catch { /* Branch may already be deleted */ }

  // Remove draft record
  await deleteDraft(database, draft.id);

  return new Response(JSON.stringify({ success: true }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
}

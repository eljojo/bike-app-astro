import type { APIContext } from 'astro';
import { authorize } from '../../lib/auth/authorize';
import { jsonResponse } from '../../lib/api-response';
import { env } from '../../lib/env/env.service';
import { db } from '../../lib/get-db';
import { contentEdits } from '../../db/schema';
import { desc } from 'drizzle-orm';
import { eq } from 'drizzle-orm';
import { CITY } from '../../lib/config/config';
import { getDeployWorkflowRuns } from '../../lib/external/github-actions';

export const prerender = false;

export async function GET({ locals }: APIContext) {
  const user = authorize(locals, 'view-history');
  if (user instanceof Response) return user;

  if (env.ENVIRONMENT === 'local' || !env.GITHUB_TOKEN) {
    return jsonResponse({ status: 'idle' });
  }

  try {
    const database = db();
    const [latestEdit] = await database
      .select({ updatedAt: contentEdits.updatedAt })
      .from(contentEdits)
      .where(eq(contentEdits.city, CITY))
      .orderBy(desc(contentEdits.updatedAt))
      .limit(1);

    const codeRepo = 'bike-app-astro';
    const deployWorkflow = env.ENVIRONMENT === 'staging' ? 'staging.yml' : 'production.yml';
    const { latestRun, latestSuccessfulRun } = await getDeployWorkflowRuns({
      token: env.GITHUB_TOKEN,
      owner: env.GIT_OWNER,
      repo: codeRepo,
      workflowFiles: [deployWorkflow, 'ci.yml'],
    });

    // Active workflow takes priority — show progress regardless of contentEdits state.
    // Deploys can be triggered by data repo pushes, code merges, or manual dispatch,
    // not just admin UI saves that create contentEdits rows.
    if (latestRun && (latestRun.status === 'in_progress' || latestRun.status === 'queued')) {
      const startTime = new Date(latestRun.created_at).getTime();
      const elapsed = Date.now() - startTime;
      const estimatedTotal = 5 * 60 * 1000;
      const progress = Math.min(Math.round((elapsed / estimatedTotal) * 100), 95);
      const remainingMs = Math.max(estimatedTotal - elapsed, 0);
      const estimatedMinutes = Math.max(1, Math.ceil(remainingMs / 60000));

      return jsonResponse({
        status: 'deploying',
        progress,
        estimatedMinutes,
      });
    }

    const lastSuccessTime = latestSuccessfulRun?.updated_at ?? null;
    const lastEditTime = latestEdit?.updatedAt ?? null;

    // No admin edits tracked — nothing to show as pending
    if (!lastEditTime) {
      return jsonResponse({ status: 'idle' });
    }

    const hasPendingChanges = lastSuccessTime
      ? new Date(lastEditTime) > new Date(lastSuccessTime)
      : true;

    if (!hasPendingChanges) {
      return jsonResponse({ status: 'idle' });
    }

    return jsonResponse({ status: 'queued' });
  } catch {
    return jsonResponse({ status: 'idle' });
  }
}

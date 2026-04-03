import type { APIContext } from 'astro';
import { z } from 'zod/v4';
import { env } from '../../lib/env/env.service';
import { createGitService } from '../../lib/git/git-factory';
import { authorize } from '../../lib/auth/authorize';
import { jsonResponse, jsonError } from '../../lib/api-response';
import { db } from '../../lib/get-db';
import { checkRateLimit, recordAttempt } from '../../lib/auth/rate-limit';

const diffRequestSchema = z.object({
  commitSha: z.string().regex(/^[0-9a-f]{40}$/, 'commitSha must be a 40-character hex string'),
  contentPath: z.string().optional(),
});

export const prerender = false;

const ANON_LIMIT = 30;

export async function POST({ request, locals }: APIContext) {
  const user = authorize(locals, 'view-history');
  if (user instanceof Response) {
    const ip = request.headers.get('cf-connecting-ip')
      || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || 'unknown';
    const database = db();
    const limited = await checkRateLimit(database, 'view-history', [ip], ANON_LIMIT);
    if (limited) return jsonError('Too many requests', 429);
    await recordAttempt(database, 'view-history', [ip]);
  }

  let body;
  try {
    body = diffRequestSchema.parse(await request.json());
  } catch {
    return jsonError('Invalid request body', 400);
  }
  const { commitSha, contentPath } = body;

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

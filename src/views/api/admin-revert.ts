import type { APIContext } from 'astro';
import { env } from '../../lib/env';
import { createGitService } from '../../lib/git-factory';
import { db } from '../../lib/get-db';
import { contentEdits } from '../../db/schema';
import { eq, and } from 'drizzle-orm';
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

  const { commitSha, contentType, contentId } = await request.json();
  if (!commitSha || !contentType || !contentId) {
    return jsonError('Missing commitSha, contentType, or contentId');
  }

  const baseBranch = env.GIT_BRANCH || 'main';
  const git = createGitService({
    token: env.GITHUB_TOKEN,
    owner: GIT_OWNER,
    repo: GIT_DATA_REPO,
    branch: baseBranch,
  });

  try {
    // Get the file at the parent commit (state before the commit we're reverting)
    const parentSha = `${commitSha}^`;

    // Determine the file path based on content type
    const city = 'ottawa';
    let filePath: string;
    if (contentType === 'routes') {
      filePath = `${city}/routes/${contentId}/index.md`;
    } else if (contentType === 'events') {
      filePath = `${city}/events/${contentId}.md`;
    } else {
      return jsonError('Unsupported content type');
    }

    const parentFile = await git.getFileAtCommit(parentSha, filePath);
    if (!parentFile) {
      return jsonError('Could not read file at parent commit');
    }

    // Get the commit info for the revert message
    const commits = await git.listCommits({ perPage: 1 });
    const user = locals.user!;

    const revertMessage = `Revert: "${commitSha.slice(0, 7)}" on ${contentId}`;
    const authorInfo = {
      name: user.username,
      email: user.email || `${user.username}@whereto.bike`,
    };

    const sha = await git.writeFiles(
      [{ path: filePath, content: parentFile.content }],
      revertMessage,
      authorInfo,
    );

    // Update D1 cache with the reverted content
    const database = db();
    const newFile = await git.readFile(filePath);
    if (newFile) {
      await database.insert(contentEdits).values({
        contentType,
        contentSlug: contentId,
        data: parentFile.content,
        githubSha: newFile.sha,
        updatedAt: new Date().toISOString(),
      }).onConflictDoUpdate({
        target: [contentEdits.contentType, contentEdits.contentSlug],
        set: {
          data: parentFile.content,
          githubSha: newFile.sha,
          updatedAt: new Date().toISOString(),
        },
      });
    }

    return jsonResponse({ success: true, sha });
  } catch (err: any) {
    console.error('revert error:', err);
    return jsonError(err.message || 'Failed to revert', 500);
  }
}

import type { APIContext } from 'astro';
import { env } from '../../lib/env';
import { createGitService } from '../../lib/git-factory';
import { db } from '../../lib/get-db';
import { contentEdits } from '../../db/schema';
import { GIT_OWNER, GIT_DATA_REPO, CITY } from '../../lib/config';
import { requireAdmin } from '../../lib/auth';
import { jsonResponse, jsonError } from '../../lib/api-response';
import { buildAuthorEmail, buildResourcePathRegex } from '../../lib/commit-author';

export const prerender = false;

/**
 * Parse a content path to extract contentType and contentSlug for D1 cache.
 * E.g. "ottawa/routes/pink-aylmer/index.md" → { contentType: 'routes', contentSlug: 'pink-aylmer' }
 * E.g. "ottawa/events/2026/bike-fest.md" → { contentType: 'events', contentSlug: '2026/bike-fest' }
 */
function parseContentPath(contentPath: string): { contentType: string; contentSlug: string } | null {
  const re = buildResourcePathRegex(CITY);
  const match = contentPath.match(re);
  if (!match) return null;

  const resourcePath = match[0];
  const parts = resourcePath.split('/');
  const contentType = parts[1];
  const contentSlug = parts.slice(2).join('/');
  return { contentType, contentSlug };
}

export async function POST({ request, locals }: APIContext) {
  try {
    requireAdmin(locals.user);
  } catch {
    return jsonError('Unauthorized', 401);
  }

  const { commitSha, contentPath } = await request.json();
  if (!commitSha || !contentPath) {
    return jsonError('Missing commitSha or contentPath');
  }

  const baseBranch = env.GIT_BRANCH || 'main';
  const git = createGitService({
    token: env.GITHUB_TOKEN,
    owner: GIT_OWNER,
    repo: GIT_DATA_REPO,
    branch: baseBranch,
  });

  try {
    // Read the file at the target commit SHA (restore to this version)
    const fileAtCommit = await git.getFileAtCommit(commitSha, contentPath);
    if (!fileAtCommit) {
      return jsonError('Could not read file at this commit');
    }

    const user = locals.user!;
    const parsed = parseContentPath(contentPath);
    const resourceLabel = parsed ? `${CITY}/${parsed.contentType}/${parsed.contentSlug}` : contentPath;
    const restoreMessage = `Restore ${resourceLabel} to ${commitSha.slice(0, 7)}`;
    const authorInfo = {
      name: user.username,
      email: buildAuthorEmail(user),
    };

    const sha = await git.writeFiles(
      [{ path: contentPath, content: fileAtCommit.content }],
      restoreMessage,
      authorInfo,
    );

    // Update D1 cache if this is a known content type
    if (parsed) {
      const database = db();
      const newFile = await git.readFile(contentPath);
      if (newFile) {
        await database.insert(contentEdits).values({
          contentType: parsed.contentType,
          contentSlug: parsed.contentSlug,
          data: fileAtCommit.content,
          githubSha: newFile.sha,
          updatedAt: new Date().toISOString(),
        }).onConflictDoUpdate({
          target: [contentEdits.contentType, contentEdits.contentSlug],
          set: {
            data: fileAtCommit.content,
            githubSha: newFile.sha,
            updatedAt: new Date().toISOString(),
          },
        });
      }
    }

    return jsonResponse({ success: true, sha });
  } catch (err: any) {
    console.error('restore error:', err);
    return jsonError(err.message || 'Failed to restore', 500);
  }
}

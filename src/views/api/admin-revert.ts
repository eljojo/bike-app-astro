import type { APIContext } from 'astro';
import matter from 'gray-matter';
import { env } from '../../lib/env';
import { createGitService } from '../../lib/git-factory';
import { db } from '../../lib/get-db';
import { contentEdits } from '../../db/schema';
import { GIT_OWNER, GIT_DATA_REPO, CITY } from '../../lib/config';
import { requireAdmin } from '../../lib/auth';
import { jsonResponse, jsonError } from '../../lib/api-response';
import { buildAuthorEmail, parseContentPath } from '../../lib/commit-author';
import { routeDetailFromGit, routeDetailToCache } from '../../lib/models/route-model';
import { eventDetailFromGit, eventDetailToCache } from '../../lib/models/event-model';

export const prerender = false;

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
    const parsed = parseContentPath(CITY, contentPath);
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
        const { data: fm, content: body } = matter(fileAtCommit.content);
        let cacheData: string | null = null;

        if (parsed.contentType === 'routes') {
          const basePath = contentPath.replace(/\/index\.md$/, '').replace(/\.md$/, '');
          const mediaFile = await git.readFile(`${basePath}/media.yml`);
          const detail = routeDetailFromGit(parsed.contentSlug, fm, body, mediaFile?.content);
          cacheData = routeDetailToCache(detail);
        } else if (parsed.contentType === 'events') {
          const detail = eventDetailFromGit(parsed.contentSlug, fm, body);
          cacheData = eventDetailToCache(detail);
        }

        if (cacheData !== null) {
          await database.insert(contentEdits).values({
            contentType: parsed.contentType,
            contentSlug: parsed.contentSlug,
            data: cacheData,
            githubSha: newFile.sha,
            updatedAt: new Date().toISOString(),
          }).onConflictDoUpdate({
            target: [contentEdits.contentType, contentEdits.contentSlug],
            set: {
              data: cacheData,
              githubSha: newFile.sha,
              updatedAt: new Date().toISOString(),
            },
          });
        }
      }
    }

    return jsonResponse({ success: true, sha });
  } catch (err: any) {
    console.error('restore error:', err);
    return jsonError(err.message || 'Failed to restore', 500);
  }
}

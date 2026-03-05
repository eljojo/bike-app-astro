import type { APIContext } from 'astro';
import matter from 'gray-matter';
import { env } from '../../lib/env';
import { createGitService } from '../../lib/git-factory';
import { db } from '../../lib/get-db';
import { GIT_OWNER, GIT_DATA_REPO, CITY } from '../../lib/config';
import { upsertContentCache } from '../../lib/cache';
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
    // Determine which files this commit changed
    const changedFiles = await git.getCommitFiles(commitSha);
    if (changedFiles.length === 0) {
      return jsonError('No files found in this commit');
    }

    // For content-scoped restores, filter to files under the content path's directory
    const contentDir = contentPath.replace(/\/[^/]+$/, '/');
    const relevantFiles = changedFiles.filter(f => f.startsWith(contentDir) || f === contentPath);
    const filesToRestore = relevantFiles.length > 0 ? relevantFiles : [contentPath];

    // Read each file at the target commit
    const restoreFiles: { path: string; content: string }[] = [];
    for (const filePath of filesToRestore) {
      const fileAtCommit = await git.getFileAtCommit(commitSha, filePath);
      if (fileAtCommit) {
        restoreFiles.push({ path: filePath, content: fileAtCommit.content });
      }
    }

    if (restoreFiles.length === 0) {
      return jsonError('Could not read files at this commit');
    }

    // Check if content already matches HEAD (avoid empty commit)
    let hasChanges = false;
    for (const file of restoreFiles) {
      const current = await git.readFile(file.path);
      if (!current || current.content !== file.content) {
        hasChanges = true;
        break;
      }
    }

    if (!hasChanges) {
      return jsonResponse({ success: true, message: 'Content already matches this version' });
    }

    const user = locals.user!;
    const parsed = parseContentPath(CITY, contentPath);
    const resourceLabel = parsed ? `${CITY}/${parsed.contentType}/${parsed.contentSlug}` : contentPath;
    const restoreMessage = `Restore ${resourceLabel} to ${commitSha.slice(0, 7)}`;
    const authorInfo = {
      name: user.username,
      email: buildAuthorEmail(user),
    };

    const sha = await git.writeFiles(restoreFiles, restoreMessage, authorInfo);

    // Update D1 cache if this is a known content type
    if (parsed) {
      const database = db();
      const primaryPath = parsed.contentType === 'routes'
        ? `${CITY}/routes/${parsed.contentSlug}/index.md`
        : `${CITY}/events/${parsed.contentSlug}.md`;
      const newFile = await git.readFile(primaryPath);
      if (newFile) {
        const primaryRestore = restoreFiles.find(f => f.path === primaryPath);
        const primaryContent = primaryRestore?.content || newFile.content;
        const { data: fm, content: body } = matter(primaryContent);
        let cacheData: string | null = null;

        if (parsed.contentType === 'routes') {
          const basePath = `${CITY}/routes/${parsed.contentSlug}`;
          const mediaFile = await git.readFile(`${basePath}/media.yml`);
          const frFile = await git.readFile(`${basePath}/index.fr.md`);
          const translations: Record<string, { name?: string; tagline?: string; body?: string }> = {};
          if (frFile) {
            const { data: frFm, content: frBody } = matter(frFile.content);
            translations['fr'] = {
              name: frFm.name as string | undefined,
              tagline: frFm.tagline as string | undefined,
              body: frBody.trim() || undefined,
            };
          }
          const detail = routeDetailFromGit(parsed.contentSlug, fm, body, mediaFile?.content, translations);
          cacheData = routeDetailToCache(detail);
        } else if (parsed.contentType === 'events') {
          const detail = eventDetailFromGit(parsed.contentSlug, fm, body);
          cacheData = eventDetailToCache(detail);
        }

        if (cacheData !== null) {
          await upsertContentCache(database, {
            contentType: parsed.contentType,
            contentSlug: parsed.contentSlug,
            data: cacheData,
            githubSha: newFile.sha,
          });
        }
      }
    }

    return jsonResponse({ success: true, sha });
  } catch (err: unknown) {
    console.error('restore error:', err);
    const message = err instanceof Error ? err.message : 'Failed to restore';
    return jsonError(message, 500);
  }
}

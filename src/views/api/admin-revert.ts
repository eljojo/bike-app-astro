import type { APIContext } from 'astro';
import { env } from '../../lib/env/env.service';
import { createGitService } from '../../lib/git/git-factory';
import { commitToContentRepo } from '../../lib/git/commit';
import { db } from '../../lib/get-db';
import { CITY } from '../../lib/config/config';
import { upsertContentCache } from '../../lib/content/cache';
import { authorize } from '../../lib/auth/authorize';
import { jsonResponse, jsonError } from '../../lib/api-response';
import { buildAuthorEmail, parseContentPath } from '../../lib/git/commit-author';
import { contentTypes } from '../../lib/content/content-types';
import { readCurrentState } from '../../lib/content/content-save';
import type { IGitService } from '../../lib/git/git.adapter-github';
import type { Database } from '../../db';

export const prerender = false;

export async function POST({ request, locals }: APIContext) {
  const user = authorize(locals, 'revert-commit');
  if (user instanceof Response) return user;

  const { commitSha, contentPath } = await request.json();
  if (!commitSha || !contentPath) {
    return jsonError('Missing commitSha or contentPath');
  }

  const baseBranch = env.GIT_BRANCH || 'main';
  const git = createGitService({
    token: env.GITHUB_TOKEN,
    owner: env.GIT_OWNER,
    repo: env.GIT_DATA_REPO,
    branch: baseBranch,
  });

  try {
    const restoreFiles = await fetchFilesAtCommit(git, commitSha, contentPath);
    if (!restoreFiles) {
      return jsonError('Could not read files at this commit');
    }

    if (!await hasContentChanges(git, restoreFiles)) {
      return jsonResponse({ success: true, message: 'Content already matches this version' });
    }

    const parsed = parseContentPath(CITY, contentPath);
    const resourceLabel = parsed ? `${CITY}/${parsed.contentType}/${parsed.contentSlug}` : contentPath;
    const authorInfo = { name: user.username, email: buildAuthorEmail(user) };
    const sha = await commitToContentRepo(
      `Restore ${resourceLabel} to ${commitSha.slice(0, 7)}`,
      restoreFiles, authorInfo, git);

    if (parsed) {
      await rebuildContentCache(git, db(), parsed);
    }

    return jsonResponse({ success: true, sha });
  } catch (err: unknown) {
    console.error('restore error:', err);
    const message = err instanceof Error ? err.message : 'Failed to restore';
    return jsonError(message, 500);
  }
}

/** Determine which files the commit changed and read them at that revision. */
async function fetchFilesAtCommit(
  git: IGitService,
  commitSha: string,
  contentPath: string,
): Promise<{ path: string; content: string }[] | null> {
  const changedFiles = await git.getCommitFiles(commitSha);
  if (changedFiles.length === 0) return null;

  const contentDir = contentPath.replace(/\/[^/]+$/, '/');
  const relevantFiles = changedFiles.filter(f => f.startsWith(contentDir) || f === contentPath);
  const filesToRestore = relevantFiles.length > 0 ? relevantFiles : [contentPath];

  const results: { path: string; content: string }[] = [];
  for (const filePath of filesToRestore) {
    const fileAtCommit = await git.getFileAtCommit(commitSha, filePath);
    if (fileAtCommit) {
      results.push({ path: filePath, content: fileAtCommit.content });
    }
  }

  return results.length > 0 ? results : null;
}

/** Check whether any of the restored files differ from HEAD. */
async function hasContentChanges(
  git: IGitService,
  restoreFiles: { path: string; content: string }[],
): Promise<boolean> {
  for (const file of restoreFiles) {
    const current = await git.readFile(file.path);
    if (!current || current.content !== file.content) return true;
  }
  return false;
}

/** Rebuild the D1 content cache after a restore using registry ops. */
async function rebuildContentCache(
  git: IGitService,
  database: Database,
  parsed: { contentType: string; contentSlug: string },
): Promise<void> {
  const config = contentTypes.find(ct => ct.name === parsed.contentType);
  if (!config?.ops) return;

  const filePaths = config.ops.getFilePaths(parsed.contentSlug);
  const currentFiles = await readCurrentState(git, filePaths);
  if (!currentFiles.primaryFile) return;

  const cacheData = config.ops.buildFreshData(parsed.contentSlug, currentFiles);
  await upsertContentCache(database, {
    contentType: parsed.contentType,
    contentSlug: parsed.contentSlug,
    data: cacheData,
    githubSha: currentFiles.primaryFile.sha,
  });
}

import type { APIContext } from 'astro';
import matter from 'gray-matter';
import { env } from '../../lib/env';
import { createGitService } from '../../lib/git-factory';
import { db } from '../../lib/get-db';
import { CITY } from '../../lib/config';
import { upsertContentCache } from '../../lib/cache';
import { authorize } from '../../lib/authorize';
import { jsonResponse, jsonError } from '../../lib/api-response';
import { buildAuthorEmail, parseContentPath } from '../../lib/commit-author';
import { routeDetailFromGit, routeDetailToCache } from '../../lib/models/route-model';
import { eventDetailFromGit, eventDetailToCache } from '../../lib/models/event-model';
import { supportedLocales, defaultLocale } from '../../lib/locale-utils';
import type { IGitService } from '../../lib/git-service';
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
    const sha = await git.writeFiles(restoreFiles, `Restore ${resourceLabel} to ${commitSha.slice(0, 7)}`, authorInfo);

    if (parsed) {
      await rebuildContentCache(git, db(), parsed, restoreFiles);
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

/** Read translation files from git for all secondary locales. */
async function readTranslations(
  git: IGitService,
  basePath: string,
): Promise<Record<string, { name?: string; tagline?: string; body?: string }>> {
  const secondaryLocales = supportedLocales().filter(l => l !== defaultLocale());
  const translations: Record<string, { name?: string; tagline?: string; body?: string }> = {};

  for (const locale of secondaryLocales) {
    const file = await git.readFile(`${basePath}/index.${locale}.md`);
    if (file) {
      const { data: fm, content: body } = matter(file.content);
      translations[locale] = {
        name: fm.name as string | undefined,
        tagline: fm.tagline as string | undefined,
        body: body.trim() || undefined,
      };
    }
  }

  return translations;
}

/** Rebuild the D1 content cache after a restore. */
async function rebuildContentCache(
  git: IGitService,
  database: Database,
  parsed: { contentType: string; contentSlug: string },
  restoreFiles: { path: string; content: string }[],
): Promise<void> {
  const primaryPath = parsed.contentType === 'routes'
    ? `${CITY}/routes/${parsed.contentSlug}/index.md`
    : `${CITY}/events/${parsed.contentSlug}.md`;

  const newFile = await git.readFile(primaryPath);
  if (!newFile) return;

  const primaryRestore = restoreFiles.find(f => f.path === primaryPath);
  const { data: fm, content: body } = matter(primaryRestore?.content || newFile.content);

  let cacheData: string | null = null;
  if (parsed.contentType === 'routes') {
    const basePath = `${CITY}/routes/${parsed.contentSlug}`;
    const mediaFile = await git.readFile(`${basePath}/media.yml`);
    const translations = await readTranslations(git, basePath);
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

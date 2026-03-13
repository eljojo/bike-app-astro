import type { APIContext } from 'astro';
import { env } from './env';
import { createGitService } from './git-factory';
import { db } from './get-db';
import { contentEdits } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import { CITY } from './config';
import { jsonResponse, jsonError } from './api-response';
import { computeBlobSha } from './git-service';
import type { IGitService, FileChange } from './git-service';
import type { SessionUser } from './auth';
import { authorize, can } from './authorize';
import { buildAuthorEmail } from './commit-author';
import { upsertContentCache } from './cache';

export interface CurrentFiles {
  primaryFile: { content: string; sha: string } | null;
  auxiliaryFiles?: Record<string, { content: string; sha: string } | null>;
}

export interface BuildResult {
  files: FileChange[];
  deletePaths: string[];
  isNew: boolean;
}

export interface SaveHandlers<T, R extends BuildResult = BuildResult> {
  /** Parse and validate the request body. Throw on invalid input. */
  parseRequest(body: unknown): T;

  /** Resolve the content slug/id from route params and parsed update. */
  resolveContentId(params: Record<string, string | undefined>, update: T): string;

  /** Get file paths to read from git. Returns primary path and optional auxiliary paths. */
  getFilePaths(contentId: string): { primary: string; auxiliary?: string[] };

  /** Compute content hash from current files (for compare-and-swap). */
  computeContentHash(currentFiles: CurrentFiles): string;

  /** Build fresh data for D1 cache on conflict. */
  buildFreshData(contentId: string, currentFiles: CurrentFiles): string;

  /** Build the file changes and delete paths for the git commit. */
  buildFileChanges(
    update: T,
    contentId: string,
    currentFiles: CurrentFiles,
    git: IGitService,
  ): Promise<R>;

  /** Build the commit message. */
  buildCommitMessage(update: T, contentId: string, isNew: boolean, currentFiles: CurrentFiles): string;

  /** Build the GitHub URL for conflict notices. */
  buildGitHubUrl(contentId: string, baseBranch: string): string;
}

export interface WithSlugValidation {
  validateSlug(slug: string): string | null;
}

export interface WithExistenceCheck {
  checkExistence(git: IGitService, contentId: string): Promise<Response | string | null>;
}

export interface WithAfterCommit<R extends BuildResult = BuildResult> {
  afterCommit(result: R, database: ReturnType<typeof db>): Promise<void>;
}

export async function saveContent<T extends { contentHash?: string }, R extends BuildResult = BuildResult>(
  request: Request,
  locals: APIContext['locals'],
  params: Record<string, string | undefined>,
  contentType: string,
  handlers: SaveHandlers<T, R> & Partial<WithSlugValidation & WithExistenceCheck & WithAfterCommit<R>>,
): Promise<Response> {
  const auth = await authenticateAndParse(request, locals, params, handlers);
  if (auth instanceof Response) return auth;
  const { user, update } = auth;
  let { contentId } = auth;

  try {
    const baseBranch = env.GIT_BRANCH || 'main';
    const database = db();
    const git = createGitService({
      token: env.GITHUB_TOKEN,
      owner: env.GIT_OWNER,
      repo: env.GIT_DATA_REPO,
      branch: baseBranch,
    });

    if ('checkExistence' in handlers && handlers.checkExistence) {
      const result = await handlers.checkExistence(git, contentId);
      if (result instanceof Response) return result;
      if (typeof result === 'string') contentId = result;
    }

    const filePaths = handlers.getFilePaths(contentId);
    const currentFiles = await readCurrentState(git, filePaths);

    const conflict = await detectConflict(database, contentType, contentId, currentFiles, update, handlers, baseBranch);
    if (conflict) return conflict;

    const buildResult = await handlers.buildFileChanges(update, contentId, currentFiles, git);
    const { files, deletePaths, isNew } = buildResult;

    if (await hasNoChanges(files, deletePaths, isNew, currentFiles, filePaths, git)) {
      const currentHash = handlers.computeContentHash(currentFiles);
      return jsonResponse({ success: true, id: contentId, contentHash: currentHash });
    }

    const appEmail = buildAuthorEmail(user);
    const useRealEmail = user.emailInCommits && user.email;
    const authorInfo = { name: user.username, email: (useRealEmail && user.email) || appEmail };
    let message = handlers.buildCommitMessage(update, contentId, isNew, currentFiles);
    if (useRealEmail) {
      message += `\nCo-Authored-By: ${user.username} <${appEmail}>`;
    }
    const appBranch: string = typeof __APP_BRANCH__ !== 'undefined' ? __APP_BRANCH__ : 'unknown';
    if (env.ENVIRONMENT === 'staging' && appBranch !== 'main') {
      message += `\nApp-Branch: ${appBranch}`;
    }
    const sha = await git.writeFiles(files, message, authorInfo,
      deletePaths.length > 0 ? deletePaths : undefined);

    const response = await updateCacheAfterCommit(database, contentType, contentId, filePaths, files, deletePaths, currentFiles, handlers, sha);

    if (response.ok && 'afterCommit' in handlers && handlers.afterCommit) {
      try {
        await handlers.afterCommit(buildResult, database);
      } catch (err) {
        console.error(`afterCommit for ${contentType} failed:`, err);
      }
    }

    return response;
  } catch (err: unknown) {
    console.error(`save ${contentType} error:`, err);
    const message = err instanceof Error ? err.message : 'Failed to save';
    return jsonError(message, 500);
  }
}

async function authenticateAndParse<T, R extends BuildResult>(
  request: Request,
  locals: APIContext['locals'],
  params: Record<string, string | undefined>,
  handlers: SaveHandlers<T, R> & Partial<WithSlugValidation>,
): Promise<{ user: SessionUser; update: T; contentId: string } | Response> {
  const user = authorize(locals, 'edit-content');
  if (user instanceof Response) return user;

  let update: T;
  try {
    const body = await request.json();
    update = handlers.parseRequest(body);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Invalid JSON body';
    return jsonError(message);
  }

  if (!can(user, 'set-status')) {
    const u = update as Record<string, unknown>;
    if (u.frontmatter && typeof u.frontmatter === 'object') {
      delete (u.frontmatter as Record<string, unknown>).status;
    }
  }

  if (!can(user, 'edit-slug')) {
    delete (update as Record<string, unknown>).newSlug;
  }

  const contentId = handlers.resolveContentId(params, update);
  if ('validateSlug' in handlers && handlers.validateSlug) {
    const slugError = handlers.validateSlug(contentId);
    if (slugError) return jsonError(slugError);
  }

  return { user, update, contentId };
}

async function readCurrentState(
  git: IGitService,
  filePaths: { primary: string; auxiliary?: string[] },
): Promise<CurrentFiles> {
  const primaryFile = await git.readFile(filePaths.primary);
  const auxiliaryFiles: Record<string, { content: string; sha: string } | null> = {};
  if (filePaths.auxiliary) {
    for (const auxPath of filePaths.auxiliary) {
      auxiliaryFiles[auxPath] = await git.readFile(auxPath);
    }
  }
  return { primaryFile, auxiliaryFiles };
}

async function detectConflict<T extends { contentHash?: string }, R extends BuildResult>(
  database: ReturnType<typeof db>,
  contentType: string,
  contentId: string,
  currentFiles: CurrentFiles,
  update: T,
  handlers: SaveHandlers<T, R>,
  baseBranch: string,
): Promise<Response | null> {
  if (!currentFiles.primaryFile) return null;

  const cached = await database.select().from(contentEdits)
    .where(and(eq(contentEdits.city, CITY), eq(contentEdits.contentType, contentType), eq(contentEdits.contentSlug, contentId)))
    .get();

  let hasConflict = false;
  if (cached) {
    hasConflict = cached.githubSha !== currentFiles.primaryFile.sha;
  } else if (update.contentHash) {
    const currentHash = handlers.computeContentHash(currentFiles);
    hasConflict = currentHash !== update.contentHash;
  }

  if (!hasConflict) return null;

  const freshData = handlers.buildFreshData(contentId, currentFiles);
  await upsertContentCache(database, {
    contentType,
    contentSlug: contentId,
    data: freshData,
    githubSha: currentFiles.primaryFile.sha,
  });

  return jsonResponse({
    error: `This ${contentType.replace(/s$/, '')} was modified on GitHub since you started editing.`,
    githubUrl: handlers.buildGitHubUrl(contentId, baseBranch),
    conflict: true,
  }, 409);
}

async function hasNoChanges(
  files: FileChange[],
  deletePaths: string[],
  isNew: boolean,
  currentFiles: CurrentFiles,
  filePaths: { primary: string; auxiliary?: string[] },
  git: IGitService,
): Promise<boolean> {
  if (isNew || deletePaths.length > 0) return false;

  const knownContent = new Map<string, string>();
  if (currentFiles.primaryFile) {
    knownContent.set(filePaths.primary, currentFiles.primaryFile.content);
  }
  if (currentFiles.auxiliaryFiles) {
    for (const [p, f] of Object.entries(currentFiles.auxiliaryFiles)) {
      if (f) knownContent.set(p, f.content);
    }
  }

  for (const f of files) {
    let current = knownContent.get(f.path);
    if (current === undefined) {
      const gitFile = await git.readFile(f.path);
      current = gitFile?.content;
    }
    if (current === undefined || current !== f.content) return false;
  }

  return true;
}

async function updateCacheAfterCommit<T extends { contentHash?: string }, R extends BuildResult>(
  database: ReturnType<typeof db>,
  contentType: string,
  contentId: string,
  filePaths: { primary: string; auxiliary?: string[] },
  files: FileChange[],
  deletePaths: string[],
  currentFiles: CurrentFiles,
  handlers: SaveHandlers<T, R>,
  sha: string,
): Promise<Response> {
  let committedPrimary = files.find(f => f.path === filePaths.primary);
  // Events can be flat (.md) or directory-based (index.md). The primary path
  // targets the directory format, but the actual committed file may be at an
  // auxiliary path (the flat format). Fall back to auxiliary paths so the D1
  // cache is still updated after saving flat-format content.
  if (!committedPrimary && filePaths.auxiliary) {
    committedPrimary = files.find(f => filePaths.auxiliary!.includes(f.path) && f.path.endsWith('.md'));
  }
  if (!committedPrimary) {
    return jsonResponse({ success: true, sha, id: contentId });
  }

  const primaryBlobSha = computeBlobSha(committedPrimary.content);
  const committedFiles: CurrentFiles = {
    primaryFile: { content: committedPrimary.content, sha: primaryBlobSha },
    auxiliaryFiles: {},
  };
  if (filePaths.auxiliary) {
    for (const auxPath of filePaths.auxiliary) {
      const auxFile = files.find(f => f.path === auxPath);
      if (auxFile) {
        committedFiles.auxiliaryFiles![auxPath] = {
          content: auxFile.content,
          sha: computeBlobSha(auxFile.content),
        };
        continue;
      }
      if (deletePaths.includes(auxPath)) {
        committedFiles.auxiliaryFiles![auxPath] = null;
        continue;
      }
      committedFiles.auxiliaryFiles![auxPath] = currentFiles.auxiliaryFiles?.[auxPath] ?? null;
    }
  }

  const cacheData = handlers.buildFreshData(contentId, committedFiles);
  const newContentHash = handlers.computeContentHash(committedFiles);

  await upsertContentCache(database, {
    contentType,
    contentSlug: contentId,
    data: cacheData,
    githubSha: primaryBlobSha,
  });

  return jsonResponse({ success: true, sha, id: contentId, contentHash: newContentHash });
}

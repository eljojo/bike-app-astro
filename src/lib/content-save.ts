import type { APIContext } from 'astro';
import { env } from './env';
import { createGitService } from './git-factory';
import { db } from './get-db';
import { contentEdits } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import { GIT_OWNER, GIT_DATA_REPO } from './config';
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

export interface SaveHandlers<T> {
  /** Parse and validate the request body. Throw on invalid input. */
  parseRequest(body: unknown): T;

  /** Resolve the content slug/id from route params and parsed update. */
  resolveContentId(params: Record<string, string | undefined>, update: T): string;

  /** Validate the content slug. Return error message or null. */
  validateSlug?(slug: string): string | null;

  /** Get file paths to read from git. Returns primary path and optional auxiliary paths. */
  getFilePaths(contentId: string): { primary: string; auxiliary?: string[] };

  /** Compute content hash from current files (for compare-and-swap). */
  computeContentHash(currentFiles: CurrentFiles): string;

  /** Build fresh data for D1 cache on conflict. */
  buildFreshData(contentId: string, currentFiles: CurrentFiles): string;

  /** Check for existence conflicts (new content). Return error Response or null. */
  checkExistence?(git: IGitService, contentId: string): Promise<Response | null>;

  /** Build the file changes and delete paths for the git commit. */
  buildFileChanges(
    update: T,
    contentId: string,
    currentFiles: CurrentFiles,
    git: IGitService,
  ): Promise<{ files: FileChange[]; deletePaths: string[]; isNew: boolean }>;

  /** Build the commit message. */
  buildCommitMessage(update: T, contentId: string, isNew: boolean, currentFiles: CurrentFiles): string;

  /** Build the GitHub URL for conflict notices. */
  buildGitHubUrl(contentId: string, baseBranch: string): string;
}

export async function saveContent<T extends { contentHash?: string }>(
  request: Request,
  locals: APIContext['locals'],
  params: Record<string, string | undefined>,
  contentType: string,
  handlers: SaveHandlers<T>,
): Promise<Response> {
  const auth = await authenticateAndParse(request, locals, params, handlers);
  if (auth instanceof Response) return auth;
  const { user, update, contentId } = auth;

  try {
    const baseBranch = env.GIT_BRANCH || 'main';
    const database = db();
    const git = createGitService({
      token: env.GITHUB_TOKEN,
      owner: GIT_OWNER,
      repo: GIT_DATA_REPO,
      branch: baseBranch,
    });

    if (handlers.checkExistence) {
      const err = await handlers.checkExistence(git, contentId);
      if (err) return err;
    }

    const filePaths = handlers.getFilePaths(contentId);
    const currentFiles = await readCurrentState(git, filePaths);

    const conflict = await detectConflict(database, contentType, contentId, currentFiles, update, handlers, baseBranch);
    if (conflict) return conflict;

    const { files, deletePaths, isNew } = await handlers.buildFileChanges(update, contentId, currentFiles, git);

    if (await hasNoChanges(files, deletePaths, isNew, currentFiles, filePaths, git)) {
      const currentHash = handlers.computeContentHash(currentFiles);
      return jsonResponse({ success: true, id: contentId, contentHash: currentHash });
    }

    const authorInfo = { name: user.username, email: buildAuthorEmail(user) };
    let message = handlers.buildCommitMessage(update, contentId, isNew, currentFiles);
    if (user.emailInCommits && user.email) {
      message += `\nSigned-off-by: ${user.username} <${user.email}>`;
    }
    const sha = await git.writeFiles(files, message, authorInfo,
      deletePaths.length > 0 ? deletePaths : undefined);

    return updateCacheAfterCommit(database, contentType, contentId, filePaths, files, deletePaths, currentFiles, handlers, sha);
  } catch (err: unknown) {
    console.error(`save ${contentType} error:`, err);
    const message = err instanceof Error ? err.message : 'Failed to save';
    return jsonError(message, 500);
  }
}

async function authenticateAndParse<T>(
  request: Request,
  locals: APIContext['locals'],
  params: Record<string, string | undefined>,
  handlers: SaveHandlers<T>,
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

  const contentId = handlers.resolveContentId(params, update);
  if (handlers.validateSlug) {
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

async function detectConflict<T extends { contentHash?: string }>(
  database: ReturnType<typeof db>,
  contentType: string,
  contentId: string,
  currentFiles: CurrentFiles,
  update: T,
  handlers: SaveHandlers<T>,
  baseBranch: string,
): Promise<Response | null> {
  if (!currentFiles.primaryFile) return null;

  const cached = await database.select().from(contentEdits)
    .where(and(eq(contentEdits.contentType, contentType), eq(contentEdits.contentSlug, contentId)))
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

async function updateCacheAfterCommit<T extends { contentHash?: string }>(
  database: ReturnType<typeof db>,
  contentType: string,
  contentId: string,
  filePaths: { primary: string; auxiliary?: string[] },
  files: FileChange[],
  deletePaths: string[],
  currentFiles: CurrentFiles,
  handlers: SaveHandlers<T>,
  sha: string,
): Promise<Response> {
  const committedPrimary = files.find(f => f.path === filePaths.primary);
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

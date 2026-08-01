import type { APIContext } from 'astro';
import { env } from '../env/env.service';
import { createGitService } from '../git/git-factory';
import { commitToContentRepo } from '../git/commit';
import { db } from '../get-db';
import { contentEdits } from '../../db/schema';
import { eq, and } from 'drizzle-orm';
import { CITY } from '../config/config';
import { jsonResponse, jsonError } from '../api-response';
import { computeBlobSha } from '../git/git.adapter-github';
import type { IGitService, FileChange } from '../git/git.adapter-github';
import type { SessionUser } from '../auth/auth';
import { authorize, can } from '../auth/authorize';
import { buildAuthorEmail } from '../git/commit-author';
import { upsertContentCache } from './cache';
import {
  claimFormSubmission,
  completeFormSubmission,
  releaseFormSubmission,
  FormSubmissionConflict,
} from './form-submissions';
import type { GitFiles } from '../models/content-model';

/** @deprecated Use GitFiles from content-model.ts instead */
export type CurrentFiles = GitFiles;

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
  const { user, update, formInstanceId, isNewRequest } = auth;
  let { contentId } = auth;

  // Tracks whether the git commit landed. Git is the source of truth: once it
  // lands, the claim maps to content that now exists and must NOT be released
  // on a later error (see the outer catch).
  let commitLanded = false;

  try {
    const baseBranch = env.GIT_BRANCH || 'main';
    const database = db();
    const git = createGitService({
      token: env.GITHUB_TOKEN,
      owner: env.GIT_OWNER,
      repo: env.GIT_DATA_REPO,
      branch: baseBranch,
    });

    // Form-submission rejection. Only applies to /new requests (creates):
    // the form_instance_id was minted on form-mount, so a second /new
    // POST with the same id is unambiguously a duplicate submission and
    // must be rejected — not silently merged, not auto-rerouted to update.
    if (isNewRequest && formInstanceId) {
      try {
        await claimFormSubmission(database, formInstanceId, contentType);
      } catch (err) {
        if (err instanceof FormSubmissionConflict) {
          return jsonError('This form has already been submitted. Reload the page to start fresh.', 409);
        }
        throw err;
      }
    }

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
    const sha = await commitToContentRepo(message, files, authorInfo, git,
      deletePaths.length > 0 ? deletePaths : undefined);
    commitLanded = true;

    const response = await updateCacheAfterCommit(database, contentType, contentId, filePaths, files, deletePaths, currentFiles, handlers, sha);

    if (isNewRequest && formInstanceId && response.ok) {
      try {
        await completeFormSubmission(database, formInstanceId, contentId);
      } catch (err) {
        console.error('form-submission complete failed (non-fatal):', err);
      }
    }

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
    // Only release the claim when the commit did NOT land. If the commit
    // succeeded but something after it still threw, the claim maps to content
    // that now exists — releasing it would let the client's retry re-claim,
    // find the just-committed file, and mint a duplicate (slug-2). Leave the
    // claim in place and let its 7-day TTL reap it. With the best-effort cache
    // guard in updateCacheAfterCommit, a post-commit throw here is near-
    // impossible, but keep the 500 for genuinely unknown post-commit failures.
    if (isNewRequest && formInstanceId && !commitLanded) {
      // Release the claim so the user can retry with the same form mount.
      // Best-effort: a failed release just leaves a stale row that the
      // 7-day TTL will clean up.
      try { await releaseFormSubmission(db(), formInstanceId); }
      catch (releaseErr) { console.error('form-submission release failed:', releaseErr); }
    }
    const message = err instanceof Error ? err.message : 'Failed to save';
    return jsonError(message, 500);
  }
}

async function authenticateAndParse<T, R extends BuildResult>(
  request: Request,
  locals: APIContext['locals'],
  params: Record<string, string | undefined>,
  handlers: SaveHandlers<T, R> & Partial<WithSlugValidation>,
): Promise<{ user: SessionUser; update: T; contentId: string; formInstanceId?: string; isNewRequest: boolean } | Response> {
  const user = authorize(locals, 'edit-content');
  if (user instanceof Response) return user;

  // The /new path resolves params.id === 'new'; the per-id update path
  // doesn't. The form-submission rejection only applies to creates.
  const isNewRequest = params.id === 'new' || params.slug === 'new';

  let update: T;
  let formInstanceId: string | undefined;
  try {
    const body = await request.json() as Record<string, unknown>;
    if (typeof body.form_instance_id === 'string') formInstanceId = body.form_instance_id;
    update = handlers.parseRequest(body);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Invalid JSON body';
    return jsonError(message);
  }

  if (!can(user, 'set-status')) {
    const u = update as Record<string, unknown>;
    if (u.frontmatter && typeof u.frontmatter === 'object') {
      delete (u.frontmatter as Record<string, unknown>).status;
      delete (u.frontmatter as Record<string, unknown>).featured;
      delete (u.frontmatter as Record<string, unknown>).hidden;
    }
  }

  // Organizer `ics_url` drives admin-only calendar suggestion fetching and
  // would let a non-admin point the server at an arbitrary URL. Gate it
  // alongside the other admin-only capabilities. Existing values survive a
  // non-admin save because mergeFrontmatter preserves fields the payload
  // doesn't include.
  if (!can(user, 'manage-calendar-suggestions')) {
    const u = update as Record<string, unknown>;
    if (u.frontmatter && typeof u.frontmatter === 'object') {
      delete (u.frontmatter as Record<string, unknown>).ics_url;
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

  return { user, update, contentId, formInstanceId, isNewRequest };
}

export async function readCurrentState(
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

/**
 * Resolve the file that actually holds the content. Directory-based content
 * keeps it at the primary path (index.md); flat-format events keep it in an
 * auxiliary `.md` sibling (year/slug.md), so primaryFile is null even though
 * content exists. Returns null only when nothing exists yet (a genuine create,
 * where there is nothing to conflict against).
 */
function resolveEffectivePrimary(currentFiles: CurrentFiles): GitFiles['primaryFile'] {
  if (currentFiles.primaryFile) return currentFiles.primaryFile;
  const auxFiles = currentFiles.auxiliaryFiles || {};
  for (const p of Object.keys(auxFiles)) {
    const f = auxFiles[p];
    if (f && p.endsWith('.md')) return f;
  }
  return null;
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
  const effectivePrimary = resolveEffectivePrimary(currentFiles);
  if (!effectivePrimary) return null;

  const cached = await database.select({ githubSha: contentEdits.githubSha }).from(contentEdits)
    .where(and(eq(contentEdits.city, CITY), eq(contentEdits.contentType, contentType), eq(contentEdits.contentSlug, contentId)))
    .get();

  let hasConflict = false;
  if (cached) {
    hasConflict = cached.githubSha !== effectivePrimary.sha;
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
    githubSha: effectivePrimary.sha,
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
    // Invariant: a landed commit for content saved through this pipeline always
    // touches the effective primary `.md` (directory index.md or flat sibling).
    // Reaching here means we can neither refresh the D1 row nor return a real
    // contentHash, so the client's compare-and-swap state goes stale and its
    // next save may false-conflict. Log loudly rather than swallow it.
    console.error(`updateCacheAfterCommit: committed primary not found for ${contentType}/${contentId} — D1 cache not refreshed and no contentHash returned`);
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
  // Hash is derived from the in-memory committed content, not from D1, so the
  // response carries the correct contentHash even if the cache write below
  // fails.
  const newContentHash = handlers.computeContentHash(committedFiles);

  // The commit already landed — git is the source of truth. Treat the D1 cache
  // refresh as best-effort: a failure here must NOT become a 500, because the
  // client would retry an already-committed create and duplicate it. The stale
  // D1 row self-heals on the next save, and admin reads fall back to build-time
  // virtual-module data (fromCache) until then.
  try {
    await upsertContentCache(database, {
      contentType,
      contentSlug: contentId,
      data: cacheData,
      githubSha: primaryBlobSha,
    });
  } catch (err) {
    console.error(`content cache update after commit failed (non-fatal) for ${contentType}/${contentId}:`, err);
  }

  return jsonResponse({ success: true, sha, id: contentId, contentHash: newContentHash });
}

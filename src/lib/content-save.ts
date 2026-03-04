import { createHash } from 'node:crypto';
import type { APIContext } from 'astro';
import { env } from './env';
import { createGitService } from './git-factory';
import { db } from './get-db';
import { contentEdits } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import { resolveBranch, isDirectCommit } from './draft-branch';
import { findDraft, ensureDraftBranch, handleDraftAfterCommit } from './draft-service';
import { GIT_OWNER, GIT_DATA_REPO } from './config';
import { jsonResponse, jsonError } from './api-response';
import type { IGitService, FileChange } from './git-service';
import type { SessionUser } from './auth';

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

  /** Serialize data for D1 cache after successful commit. */
  buildCacheData(update: T, contentId: string, currentFiles: CurrentFiles): string;

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
  // Phase 0: Auth
  const user = locals.user as SessionUser | undefined;
  if (!user) {
    return jsonError('Unauthorized', 401);
  }

  // Phase 0b: Parse request
  let update: T;
  try {
    const body = await request.json();
    update = handlers.parseRequest(body);
  } catch (err: any) {
    return jsonError(err.message || 'Invalid JSON body');
  }

  // Phase 0c: Resolve content ID
  const contentId = handlers.resolveContentId(params, update);
  if (handlers.validateSlug) {
    const slugError = handlers.validateSlug(contentId);
    if (slugError) return jsonError(slugError);
  }

  try {
    const baseBranch = env.GIT_BRANCH || 'main';
    const editorMode = request.headers.get('cookie')?.includes('editor_mode=1') ?? false;
    const targetBranch = resolveBranch(user, editorMode, baseBranch, contentType, contentId);
    const isDirect = isDirectCommit(user, editorMode);
    const database = db();

    const git = createGitService({
      token: env.GITHUB_TOKEN,
      owner: GIT_OWNER,
      repo: GIT_DATA_REPO,
      branch: targetBranch,
    });

    const authorInfo = {
      name: user.displayName,
      email: user.email || `${user.displayName}@users.ottawabybike.ca`,
    };

    // Phase 1: Draft branch setup
    let draft = isDirect ? null : await findDraft(database, user.id, contentType, contentId);
    const isFirstDraftSave = !isDirect && !draft;

    if (isFirstDraftSave) {
      await ensureDraftBranch(env.GITHUB_TOKEN, baseBranch, targetBranch);
    }

    // Phase 1b: Check existence for new content
    if (handlers.checkExistence) {
      const existenceError = await handlers.checkExistence(git, contentId);
      if (existenceError) return existenceError;
    }

    // Phase 2: Read current files
    const filePaths = handlers.getFilePaths(contentId);
    const primaryFile = await git.readFile(filePaths.primary);
    const auxiliaryFiles: Record<string, { content: string; sha: string } | null> = {};
    if (filePaths.auxiliary) {
      for (const auxPath of filePaths.auxiliary) {
        auxiliaryFiles[auxPath] = await git.readFile(auxPath);
      }
    }
    const currentFiles: CurrentFiles = { primaryFile, auxiliaryFiles };

    // Phase 3: Conflict detection (direct commits only)
    if (isDirect && currentFiles.primaryFile) {
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

      if (hasConflict) {
        const freshData = handlers.buildFreshData(contentId, currentFiles);

        await database.insert(contentEdits).values({
          contentType,
          contentSlug: contentId,
          data: freshData,
          githubSha: currentFiles.primaryFile.sha,
          updatedAt: new Date().toISOString(),
        }).onConflictDoUpdate({
          target: [contentEdits.contentType, contentEdits.contentSlug],
          set: {
            data: freshData,
            githubSha: currentFiles.primaryFile.sha,
            updatedAt: new Date().toISOString(),
          },
        });

        return jsonResponse({
          error: `This ${contentType.replace(/s$/, '')} was modified on GitHub since you started editing.`,
          githubUrl: handlers.buildGitHubUrl(contentId, baseBranch),
          conflict: true,
        }, 409);
      }
    }

    // Phase 4: Build and commit
    const { files, deletePaths, isNew } = await handlers.buildFileChanges(update, contentId, currentFiles, git);

    // Skip commit if nothing actually changed
    if (!isNew && deletePaths.length === 0) {
      const knownContent = new Map<string, string>();
      if (currentFiles.primaryFile) {
        knownContent.set(filePaths.primary, currentFiles.primaryFile.content);
      }
      if (currentFiles.auxiliaryFiles) {
        for (const [p, f] of Object.entries(currentFiles.auxiliaryFiles)) {
          if (f) knownContent.set(p, f.content);
        }
      }

      let hasChanges = false;
      for (const f of files) {
        let current = knownContent.get(f.path);
        if (current === undefined) {
          const gitFile = await git.readFile(f.path);
          current = gitFile?.content;
        }
        if (current === undefined || current !== f.content) {
          hasChanges = true;
          break;
        }
      }

      if (!hasChanges) {
        if (isDirect) {
          const currentHash = handlers.computeContentHash(currentFiles);
          return jsonResponse({ success: true, id: contentId, contentHash: currentHash });
        }
        return jsonResponse({ success: true, id: contentId, draft: true });
      }
    }

    const message = handlers.buildCommitMessage(update, contentId, isNew, currentFiles);
    const sha = await git.writeFiles(files, message, authorInfo,
      deletePaths.length > 0 ? deletePaths : undefined);

    // Phase 5: Post-commit
    if (!isDirect) {
      await handleDraftAfterCommit(database, {
        token: env.GITHUB_TOKEN,
        user,
        contentType,
        contentSlug: contentId,
        baseBranch,
        targetBranch,
        isFirstDraftSave,
        existingDraft: draft,
        prTitle: `${user.displayName}: ${isNew ? 'Create' : 'Update'} ${contentId}`,
      });
      return jsonResponse({ success: true, sha, id: contentId, draft: true });
    }

    // Direct commit: update D1 cache and return new contentHash
    const newPrimary = await git.readFile(filePaths.primary);
    if (newPrimary) {
      const newAuxiliary: Record<string, { content: string; sha: string } | null> = {};
      if (filePaths.auxiliary) {
        for (const auxPath of filePaths.auxiliary) {
          newAuxiliary[auxPath] = await git.readFile(auxPath);
        }
      }
      const newFiles: CurrentFiles = { primaryFile: newPrimary, auxiliaryFiles: newAuxiliary };

      const cacheData = handlers.buildCacheData(update, contentId, newFiles);
      const newContentHash = handlers.computeContentHash(newFiles);

      await database.insert(contentEdits).values({
        contentType,
        contentSlug: contentId,
        data: cacheData,
        githubSha: newPrimary.sha,
        updatedAt: new Date().toISOString(),
      }).onConflictDoUpdate({
        target: [contentEdits.contentType, contentEdits.contentSlug],
        set: {
          data: cacheData,
          githubSha: newPrimary.sha,
          updatedAt: new Date().toISOString(),
        },
      });

      return jsonResponse({ success: true, sha, id: contentId, contentHash: newContentHash });
    }

    return jsonResponse({ success: true, sha, id: contentId });
  } catch (err: any) {
    console.error(`save ${contentType} error:`, err);
    return jsonError(err.message || 'Failed to save', 500);
  }
}

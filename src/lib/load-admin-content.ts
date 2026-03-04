import { env } from './env';
import { createGitService } from './git-factory';
import { db as getDb } from './get-db';
import { contentEdits } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import { findDraft, deleteDraft } from './draft-service';
import { GIT_OWNER, GIT_DATA_REPO } from './config';
import type { SessionUser } from './auth';

export interface AdminContentResult<T> {
  data: T | null;
  isDraft: boolean;
  draftPrNumber: number | null;
}

/**
 * Three-tier data loading for admin detail pages:
 * 1. Draft branch (if user has one)
 * 2. D1 content_edits cache
 * 3. Build-time virtual module data
 */
export async function loadAdminContent<T>(opts: {
  user: SessionUser | undefined;
  contentType: string;
  contentSlug: string;
  gitFilePath: string;
  parseGitFile: (git: ReturnType<typeof createGitService>, filePath: string) => Promise<T | null>;
  virtualModuleData: Record<string, T>;
}): Promise<AdminContentResult<T>> {
  const database = getDb();
  let data: T | null = null;
  let isDraft = false;
  let draftPrNumber: number | null = null;

  // Tier 1: Check for draft branch
  if (opts.user) {
    const draft = await findDraft(database, opts.user.id, opts.contentType, opts.contentSlug);

    if (draft) {
      const git = createGitService({
        token: env.GITHUB_TOKEN,
        owner: GIT_OWNER,
        repo: GIT_DATA_REPO,
        branch: draft.branchName,
      });
      const branchSha = await git.getRef(draft.branchName);

      if (branchSha) {
        data = await opts.parseGitFile(git, opts.gitFilePath);
        if (data) {
          isDraft = true;
          draftPrNumber = draft.prNumber;
        }
      } else {
        // Branch gone (merged or deleted) — clean up draft row
        await deleteDraft(database, draft.id);
      }
    }
  }

  // Tier 2: D1 cache fallback
  if (!data) {
    const cached = await database.select().from(contentEdits)
      .where(and(
        eq(contentEdits.contentType, opts.contentType),
        eq(contentEdits.contentSlug, opts.contentSlug),
      ))
      .get();

    if (cached) {
      data = JSON.parse(cached.data) as T;
    }
  }

  // Tier 3: Virtual module fallback
  if (!data) {
    data = opts.virtualModuleData[opts.contentSlug] ?? null;
  }

  return { data, isDraft, draftPrNumber };
}

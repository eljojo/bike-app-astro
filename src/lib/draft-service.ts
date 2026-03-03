import { eq, and } from 'drizzle-orm';
import { drafts } from '../db/schema';
import { generateId } from './auth';
import { createGitService } from './git-factory';
import { GIT_OWNER, GIT_DATA_REPO } from './config';

import type { Database } from '../db';

export interface Draft {
  id: string;
  userId: string;
  contentType: string;
  contentSlug: string;
  branchName: string;
  prNumber: number | null;
  createdAt: string;
  updatedAt: string;
}

export async function findDraft(
  db: Database,
  userId: string,
  contentType: string,
  contentSlug: string,
): Promise<Draft | null> {
  const result = await db.select().from(drafts)
    .where(and(
      eq(drafts.userId, userId),
      eq(drafts.contentType, contentType),
      eq(drafts.contentSlug, contentSlug),
    ))
    .limit(1);

  return (result[0] as Draft) || null;
}

export async function createDraft(
  db: Database,
  params: {
    userId: string;
    contentType: string;
    contentSlug: string;
    branchName: string;
    prNumber: number | null;
  },
): Promise<Draft> {
  const now = new Date().toISOString();
  const id = generateId();

  await db.insert(drafts).values({
    id,
    userId: params.userId,
    contentType: params.contentType,
    contentSlug: params.contentSlug,
    branchName: params.branchName,
    prNumber: params.prNumber,
    createdAt: now,
    updatedAt: now,
  });

  return { id, ...params, createdAt: now, updatedAt: now };
}

export async function deleteDraft(db: Database, draftId: string): Promise<void> {
  await db.delete(drafts).where(eq(drafts.id, draftId));
}

export async function updateDraftTimestamp(db: Database, draftId: string): Promise<void> {
  await db.update(drafts).set({ updatedAt: new Date().toISOString() }).where(eq(drafts.id, draftId));
}

export async function listDraftsForUser(db: Database, userId: string): Promise<Draft[]> {
  return await db.select().from(drafts).where(eq(drafts.userId, userId)) as Draft[];
}

/**
 * Create the draft branch from main HEAD, handling race conditions.
 */
export async function ensureDraftBranch(
  token: string,
  baseBranch: string,
  targetBranch: string,
): Promise<void> {
  const mainGit = createGitService({
    token, owner: GIT_OWNER, repo: GIT_DATA_REPO, branch: baseBranch,
  });
  const mainSha = await mainGit.getRef(baseBranch);
  if (!mainSha) throw new Error('Cannot resolve main branch');
  try {
    await mainGit.createRef(targetBranch, mainSha);
  } catch (e: any) {
    if (e.message?.includes('already exists') || e.message?.includes('Reference already exists')) {
      // Branch was created by a concurrent request — proceed
    } else {
      throw e;
    }
  }
}

/**
 * After committing to a draft branch: create PR on first save,
 * update timestamp on subsequent saves.
 */
export async function handleDraftAfterCommit(
  database: Database,
  opts: {
    token: string;
    user: { id: string; displayName: string };
    contentType: string;
    contentSlug: string;
    baseBranch: string;
    targetBranch: string;
    isFirstDraftSave: boolean;
    existingDraft: Draft | null;
    prTitle: string;
  },
): Promise<Draft | null> {
  const { token, user, contentType, contentSlug, baseBranch, targetBranch,
    isFirstDraftSave, existingDraft, prTitle } = opts;

  if (isFirstDraftSave) {
    // Re-check for draft in case a concurrent request created one
    const existing = await findDraft(database, user.id, contentType, contentSlug);
    if (existing) {
      await updateDraftTimestamp(database, existing.id);
      return existing;
    }

    const mainGit = createGitService({
      token, owner: GIT_OWNER, repo: GIT_DATA_REPO, branch: baseBranch,
    });
    const prNumber = await mainGit.createPullRequest(
      targetBranch, baseBranch,
      prTitle,
      `Community edit by ${user.displayName}`,
    );

    return createDraft(database, {
      userId: user.id, contentType, contentSlug,
      branchName: targetBranch, prNumber,
    });
  }

  if (existingDraft) {
    await updateDraftTimestamp(database, existingDraft.id);
  }
  return existingDraft;
}

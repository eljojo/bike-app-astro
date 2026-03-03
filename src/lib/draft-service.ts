import { eq, and } from 'drizzle-orm';
import { drafts } from '../db/schema';
import { generateId } from './auth';

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

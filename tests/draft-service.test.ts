import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const dbPath = path.join(import.meta.dirname, '.test-draft-service.db');

// Lazy imports to avoid issues with module resolution
let db: any;
let findDraft: any;
let createDraft: any;
let deleteDraft: any;
let updateDraftTimestamp: any;
let listDraftsForUser: any;

beforeAll(async () => {
  const { createLocalDb } = await import('../src/db/local');
  db = createLocalDb(dbPath);

  // Insert a test user
  const { users } = await import('../src/db/schema');
  await db.insert(users).values({
    id: 'user-1',
    email: null,
    displayName: 'cyclist-ab12',
    role: 'guest',
    createdAt: new Date().toISOString(),
  });

  const draftService = await import('../src/lib/draft-service');
  findDraft = draftService.findDraft;
  createDraft = draftService.createDraft;
  deleteDraft = draftService.deleteDraft;
  updateDraftTimestamp = draftService.updateDraftTimestamp;
  listDraftsForUser = draftService.listDraftsForUser;
});

afterAll(() => {
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  const walPath = dbPath + '-wal';
  const shmPath = dbPath + '-shm';
  if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
  if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);
});

describe('draft-service', () => {
  it('findDraft returns null when no draft exists', async () => {
    const result = await findDraft(db, 'user-1', 'routes', 'nonexistent');
    expect(result).toBeNull();
  });

  it('createDraft inserts a draft and returns it', async () => {
    const draft = await createDraft(db, {
      userId: 'user-1',
      contentType: 'routes',
      contentSlug: 'rideau-canal',
      branchName: 'drafts/cyclist-ab12/routes/rideau-canal',
      prNumber: null,
    });

    expect(draft.id).toBeDefined();
    expect(draft.userId).toBe('user-1');
    expect(draft.contentType).toBe('routes');
    expect(draft.branchName).toBe('drafts/cyclist-ab12/routes/rideau-canal');
  });

  it('findDraft returns the created draft', async () => {
    const draft = await findDraft(db, 'user-1', 'routes', 'rideau-canal');
    expect(draft).not.toBeNull();
    expect(draft!.contentSlug).toBe('rideau-canal');
  });

  it('updateDraftTimestamp updates the timestamp', async () => {
    const draft = await findDraft(db, 'user-1', 'routes', 'rideau-canal');
    const oldUpdatedAt = draft!.updatedAt;

    // Small delay to ensure timestamp differs
    await new Promise(r => setTimeout(r, 10));
    await updateDraftTimestamp(db, draft!.id);

    const updated = await findDraft(db, 'user-1', 'routes', 'rideau-canal');
    expect(updated!.updatedAt).not.toBe(oldUpdatedAt);
  });

  it('listDraftsForUser returns all drafts for a user', async () => {
    await createDraft(db, {
      userId: 'user-1',
      contentType: 'events',
      contentSlug: '2026/bike-fest',
      branchName: 'drafts/cyclist-ab12/events/2026/bike-fest',
      prNumber: 42,
    });

    const drafts = await listDraftsForUser(db, 'user-1');
    expect(drafts).toHaveLength(2);
    expect(drafts.map((d: any) => d.contentType).sort()).toEqual(['events', 'routes']);
  });

  it('deleteDraft removes a draft', async () => {
    const draft = await findDraft(db, 'user-1', 'routes', 'rideau-canal');
    await deleteDraft(db, draft!.id);

    const result = await findDraft(db, 'user-1', 'routes', 'rideau-canal');
    expect(result).toBeNull();
  });
});

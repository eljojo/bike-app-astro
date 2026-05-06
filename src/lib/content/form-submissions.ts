import { eq, lt } from 'drizzle-orm';
import { formSubmissions } from '../../db/schema';
import type { db } from '../get-db';

// Stale submissions linger long enough that browser back-forward replays
// and OS-level POST retries within a normal session still get rejected.
// 7 days is well past any realistic in-session retry window.
export const FORM_SUBMISSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export class FormSubmissionConflict extends Error {
  constructor(public readonly formInstanceId: string) {
    super(`form_instance_id ${formInstanceId} has already been submitted`);
    this.name = 'FormSubmissionConflict';
  }
}

/**
 * Atomically claim a form_instance_id. Throws FormSubmissionConflict if
 * the id has been used. The caller MUST call completeFormSubmission on
 * success or releaseFormSubmission on failure so retries can proceed.
 */
export async function claimFormSubmission(
  database: ReturnType<typeof db>,
  formInstanceId: string,
  contentType: string,
): Promise<void> {
  // Best-effort cleanup of stale rows so the table doesn't grow unbounded.
  await database
    .delete(formSubmissions)
    .where(lt(formSubmissions.createdAt, Date.now() - FORM_SUBMISSION_TTL_MS));

  try {
    await database.insert(formSubmissions).values({
      formInstanceId,
      contentType,
      contentId: null,
      createdAt: Date.now(),
    });
  } catch {
    // Better-sqlite3, libSQL, and D1 all surface UNIQUE constraint
    // violations through the error path; treat any insert failure as
    // "id already taken." The caller maps this to 409.
    throw new FormSubmissionConflict(formInstanceId);
  }
}

/** Mark a previously-claimed submission committed by attaching the resulting content_id. */
export async function completeFormSubmission(
  database: ReturnType<typeof db>,
  formInstanceId: string,
  contentId: string,
): Promise<void> {
  await database
    .update(formSubmissions)
    .set({ contentId })
    .where(eq(formSubmissions.formInstanceId, formInstanceId));
}

/** Release a claim so a retry with the same id can proceed (e.g. after a save failure). */
export async function releaseFormSubmission(
  database: ReturnType<typeof db>,
  formInstanceId: string,
): Promise<void> {
  await database
    .delete(formSubmissions)
    .where(eq(formSubmissions.formInstanceId, formInstanceId));
}

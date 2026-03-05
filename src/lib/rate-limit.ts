import { and, eq, gt, lt } from 'drizzle-orm';
import { uploadAttempts } from '../db/schema';
import type { Database, DbClient } from '../db';

const HOUR_MS = 60 * 60 * 1000;

export const LIMITS: Record<string, number> = { guest: 10, editor: 50 };

/** Returns true if any identifier has exceeded the limit for the given action in the last hour. */
export async function checkRateLimit(
  db: Database,
  action: string,
  identifiers: string[],
  limit: number,
): Promise<boolean> {
  const cutoff = new Date(Date.now() - HOUR_MS).toISOString();

  for (const identifier of identifiers) {
    const rows = await db
      .select({ createdAt: uploadAttempts.createdAt })
      .from(uploadAttempts)
      .where(
        and(
          eq(uploadAttempts.action, action),
          eq(uploadAttempts.identifier, identifier),
          gt(uploadAttempts.createdAt, cutoff),
        ),
      );
    if (rows.length >= limit) return true;
  }

  return false;
}

/** Record one attempt row per identifier. */
export async function recordAttempt(
  db: DbClient,
  action: string,
  identifiers: string[],
): Promise<void> {
  const now = new Date().toISOString();
  await db.insert(uploadAttempts).values(
    identifiers.map((identifier) => ({ action, identifier, createdAt: now })),
  );
}

/** Delete rows older than maxAgeMs (fire-and-forget cleanup). */
export async function cleanupOldAttempts(
  db: DbClient,
  action: string,
  maxAgeMs: number = HOUR_MS,
): Promise<void> {
  const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
  await db
    .delete(uploadAttempts)
    .where(and(eq(uploadAttempts.action, action), lt(uploadAttempts.createdAt, cutoff)));
}

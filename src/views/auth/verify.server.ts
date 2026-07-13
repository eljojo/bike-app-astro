import { eq, and, gt, isNull, sql } from 'drizzle-orm';
import { emailTokens, users } from '../../db/schema';
import { buildSessionBatch, buildRevokeAllSessionsStatement } from '../../lib/auth/auth';
import { withBatch } from '../../db/transaction';
import type { Database } from '../../db';

export type ConsumeResult =
  | { ok: true; token: string; userId: string }
  | { ok: false; error: string };

/**
 * Consume a magic-link token: mark it used, verify the email, elevate a guest
 * to editor, and rotate the account's sessions — all in one atomic batch.
 *
 * The session rotation is the session-fixation defense: any session minted
 * before this elevation (e.g. a guest token planted before the account became
 * an editor) is destroyed, so only the freshly minted session survives. The
 * new session INSERT is ordered last in the batch so the revoke can't clobber
 * it.
 */
export async function consumeMagicLinkToken(database: Database, token: string): Promise<ConsumeResult> {
  const now = new Date().toISOString();

  const result = await database
    .select()
    .from(emailTokens)
    .where(
      and(
        eq(emailTokens.token, token),
        gt(emailTokens.expiresAt, now),
        isNull(emailTokens.usedAt),
      ),
    )
    .limit(1);

  const tokenRow = result[0];
  if (!tokenRow || !tokenRow.userId) {
    return { ok: false, error: 'This link is invalid or has expired. Please request a new one.' };
  }

  const userId = tokenRow.userId;
  const { token: sessionToken, statements: sessionStatements } = buildSessionBatch(database, userId);

  await withBatch(database, () => [
    database.update(emailTokens)
      .set({ usedAt: now })
      .where(eq(emailTokens.id, tokenRow.id)),
    database.update(users)
      .set({
        emailVerified: 1,
        role: sql`CASE WHEN ${users.role} = 'guest' THEN 'editor' ELSE ${users.role} END`,
      })
      .where(eq(users.id, userId)),
    buildRevokeAllSessionsStatement(database, userId),
    ...sessionStatements,
  ]);

  return { ok: true, token: sessionToken, userId };
}

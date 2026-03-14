import { eq } from 'drizzle-orm';
import { users, bannedIps } from '../../db/schema';
import type { Database } from '../../db';
import { withBatch } from '../../db/transaction';

export async function banUser(db: Database, userId: string): Promise<void> {
  const now = new Date().toISOString();

  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new Error('User not found');

  await withBatch(db, (tx) => {
    const statements: unknown[] = [
      tx.update(users).set({ bannedAt: now }).where(eq(users.id, userId)),
    ];

    if (user.role === 'guest' && user.ipAddress) {
      statements.push(
        tx.insert(bannedIps).values({
          ip: user.ipAddress,
          userId,
          bannedAt: now,
        }).onConflictDoNothing(),
      );
    }

    return statements;
  });
}

export async function unbanUser(db: Database, userId: string): Promise<void> {
  await withBatch(db, (tx) => [
    tx.update(users).set({ bannedAt: null }).where(eq(users.id, userId)),
    tx.delete(bannedIps).where(eq(bannedIps.userId, userId)),
  ]);
}

export async function isIpBanned(db: Database, ip: string): Promise<boolean> {
  const result = await db.select().from(bannedIps).where(eq(bannedIps.ip, ip)).limit(1);
  return result.length > 0;
}

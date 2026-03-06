import type { APIContext } from 'astro';
import { db } from '../../lib/get-db';
import { users, userSettings } from '../../db/schema';
import { eq } from 'drizzle-orm';
import { requireUser } from '../../lib/auth';
import { isValidUsername, sanitizeUsername } from '../../lib/username';
import { jsonResponse, jsonError } from '../../lib/api-response';

export const prerender = false;

export async function POST({ request, locals }: APIContext) {
  let user;
  try {
    user = requireUser(locals.user);
  } catch {
    return jsonError('Unauthorized', 401);
  }

  const body = await request.json();
  const database = db();

  // Username change logic
  if (body.username !== undefined) {
    const newUsername = sanitizeUsername(body.username);
    if (!isValidUsername(newUsername)) {
      return jsonError('Invalid username. Must be 2-30 characters, alphanumeric with hyphens or underscores.');
    }

    if (newUsername !== user.username) {
      // Check uniqueness
      const existing = await database
        .select({ id: users.id })
        .from(users)
        .where(eq(users.username, newUsername))
        .limit(1);

      if (existing.length > 0) {
        return jsonError('Username is already taken.');
      }

      // Get current user row for previousUsernames
      const currentRow = await database
        .select({ previousUsernames: users.previousUsernames })
        .from(users)
        .where(eq(users.id, user.id))
        .limit(1);

      const prev: string[] = currentRow[0]?.previousUsernames
        ? JSON.parse(currentRow[0].previousUsernames)
        : [];
      prev.push(user.username);

      await database
        .update(users)
        .set({
          username: newUsername,
          previousUsernames: JSON.stringify(prev),
        })
        .where(eq(users.id, user.id));
    }
  }

  // Settings upsert logic
  const settingsUpdate: Record<string, boolean> = {};
  if (body.emailInCommits !== undefined) {
    settingsUpdate.emailInCommits = Boolean(body.emailInCommits);
  }
  if (body.analyticsOptOut !== undefined) {
    settingsUpdate.analyticsOptOut = Boolean(body.analyticsOptOut);
  }

  if (Object.keys(settingsUpdate).length > 0) {
    await database
      .insert(userSettings)
      .values({
        userId: user.id,
        ...settingsUpdate,
      })
      .onConflictDoUpdate({
        target: userSettings.userId,
        set: settingsUpdate,
      });
  }

  return jsonResponse({ success: true });
}

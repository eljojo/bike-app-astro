import type { APIContext } from 'astro';
import { db } from '../../lib/get-db';
import { users, userSettings } from '../../db/schema';
import { eq, and, ne } from 'drizzle-orm';
import { normalizeEmail } from '../../lib/auth/auth';
import { authorize } from '../../lib/auth/authorize';
import { isValidUsername, sanitizeUsername } from '../../lib/username';
import { jsonResponse, jsonError } from '../../lib/api-response';

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export const prerender = false;

export async function POST({ request, locals }: APIContext) {
  const user = authorize(locals, 'update-settings');
  if (user instanceof Response) return user;

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

  // Email change logic
  if (body.email !== undefined) {
    const rawEmail = String(body.email).trim();

    if (rawEmail === '') {
      return jsonError('Email cannot be empty.');
    } else {
      if (!isValidEmail(rawEmail)) {
        return jsonError('Invalid email address.');
      }

      const email = normalizeEmail(rawEmail);

      // Only update if changed
      if (email !== user.email) {
        // Check uniqueness (exclude current user)
        const existing = await database
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.email, email), ne(users.id, user.id)))
          .limit(1);

        if (existing.length > 0) {
          return jsonError('Email is already in use.');
        }

        await database
          .update(users)
          .set({ email })
          .where(eq(users.id, user.id));
      }
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

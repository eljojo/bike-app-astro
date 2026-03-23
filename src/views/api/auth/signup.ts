export const prerender = false;

import type { APIContext } from 'astro';
import { eq, sql } from 'drizzle-orm';
import { db } from '../../../lib/get-db';
import { users, credentials } from '../../../db/schema';
import {
  normalizeEmail,
  generateId,
  findUserByIdentifier,
  isFirstUser,
} from '../../../lib/auth/auth';
import { checkRateLimit, recordAttempt } from '../../../lib/auth/rate-limit';
import { sendMagicLinkEmail } from '../../../lib/auth/magic-link.server';
import { jsonResponse, jsonError } from '../../../lib/api-response';
import { getInstanceFeatures } from '../../../lib/config/instance-features';
import { sanitizeUsername, isValidUsername, generateUsernameFromEmail } from '../../../lib/username';

const MAX_SIGNUP_PER_HOUR = 5;

export async function POST(context: APIContext): Promise<Response> {
  if (!getInstanceFeatures().allowsRegistration) {
    return new Response(null, { status: 404 });
  }

  try {
    const body = await context.request.json().catch(() => null);
    if (!body?.email || typeof body.email !== 'string') {
      return jsonError('Email is required', 400);
    }

    const email = normalizeEmail(body.email);
    if (!email.includes('@')) {
      return jsonError('Invalid email address', 400);
    }

    const database = db();

    // Rate limit: max 5 signup attempts per email per hour
    const rateLimited = await checkRateLimit(database, 'signup', [email], MAX_SIGNUP_PER_HOUR);
    if (rateLimited) {
      return jsonError('Too many attempts. Please try again later.', 429);
    }

    // Record the attempt for rate limiting
    await recordAttempt(database, 'signup', [email]);

    // Check if a user with this email already exists
    const existingUser = await findUserByIdentifier(database, email);

    if (existingUser) {
      // Existing user — check if they have passkeys
      const credentialCount = await database
        .select({ count: sql<number>`count(*)` })
        .from(credentials)
        .where(eq(credentials.userId, existingUser.id));

      const hasPasskey = (credentialCount[0]?.count ?? 0) > 0;

      if (hasPasskey) {
        return jsonResponse({ flow: 'passkey' });
      }

      // No passkey — send magic link for login
      await sendMagicLinkEmail(database, email, existingUser.id, context.url.origin);
      return jsonResponse({ flow: 'magic-link' });
    }

    // New user — validate optional username or generate one
    let username: string;
    if (body.username && typeof body.username === 'string') {
      username = sanitizeUsername(body.username);
      if (!isValidUsername(username)) {
        return jsonError('Invalid username', 400);
      }
    } else {
      username = generateUsernameFromEmail(email);
    }

    // Check username availability
    const existingUsername = await database
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, username))
      .limit(1);

    if (existingUsername.length > 0) {
      // Append random suffix to avoid collision
      const hex = Math.random().toString(16).slice(2, 6);
      username = sanitizeUsername(`${username}-${hex}`);
    }

    // Check if this is the first user (first user = admin)
    const firstUser = await isFirstUser(database);

    const userId = generateId();
    const now = new Date().toISOString();

    await database.insert(users).values({
      id: userId,
      email,
      username,
      role: firstUser ? 'admin' : 'editor',
      createdAt: now,
      emailVerified: 0,
    });

    // Send magic link for email verification
    await sendMagicLinkEmail(database, email, userId, context.url.origin);

    return jsonResponse({ flow: 'verify-email', username });
  } catch (err) {
    console.error('signup error:', err);
    return jsonError('Internal server error', 500);
  }
}

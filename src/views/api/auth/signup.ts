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
    const identifier = body?.email || body?.identifier;
    if (!identifier || typeof identifier !== 'string') {
      return jsonError('Email or username is required', 400);
    }

    const isEmail = identifier.includes('@');
    const normalizedIdentifier = isEmail ? normalizeEmail(identifier) : identifier.trim().toLowerCase();

    const database = db();

    // Rate limit: max 5 signup attempts per identifier per hour
    const rateLimited = await checkRateLimit(database, 'signup', [normalizedIdentifier], MAX_SIGNUP_PER_HOUR);
    if (rateLimited) {
      return jsonError('Too many attempts. Please try again later.', 429);
    }

    // Record the attempt for rate limiting
    await recordAttempt(database, 'signup', [normalizedIdentifier]);

    // Check if a user with this email/username already exists
    const existingUser = await findUserByIdentifier(database, normalizedIdentifier);

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

      // No passkey — send magic link for login (use user's actual email)
      if (!existingUser.email) {
        return jsonError('This account has no email. Please use a passkey.', 400);
      }
      await sendMagicLinkEmail(database, existingUser.email, existingUser.id, context.url.origin);
      return jsonResponse({ flow: 'magic-link' });
    }

    // New user — only possible with email (can't create account with just username)
    if (!isEmail) {
      return jsonError('No account found with that username', 404);
    }

    const email = normalizedIdentifier;

    // Validate optional username or generate one
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
      const hex = Array.from(crypto.getRandomValues(new Uint8Array(2)), b => b.toString(16).padStart(2, '0')).join('');
      username = sanitizeUsername(`${username}-${hex}`);
    }

    // First user must use /setup (passkey-based admin creation).
    // The signup endpoint always creates editors.
    const firstUser = await isFirstUser(database);
    if (firstUser) {
      return jsonError('Please use the setup page to create the first account', 400);
    }

    const userId = generateId();
    const now = new Date().toISOString();

    await database.insert(users).values({
      id: userId,
      email,
      username,
      role: 'editor',
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

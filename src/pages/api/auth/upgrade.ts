import type { APIContext } from 'astro';
import { env } from '../../../lib/env';
import { verifyRegistrationResponse } from '@simplewebauthn/server';
import { db } from '../../../lib/get-db';
import { users } from '../../../db/schema';
import { eq } from 'drizzle-orm';
import {
  normalizeEmail,
  createSessionWithCookies,
  storeCredential,
  destroySession,
  retrieveChallenge,
  getWebAuthnConfig,
} from '../../../lib/auth';
import { sanitizeUsername } from '../../../lib/username';
import { jsonResponse, jsonError } from '../../../lib/api-response';
import { withTransaction } from '../../../db/transaction';

export const prerender = false;

export async function POST({ request, cookies, locals }: APIContext) {
  const user = locals.user;
  if (!user || user.role !== 'guest') {
    return jsonError('Only guests can upgrade');
  }

  const { email: rawEmail, username: rawUsername, credential: credentialResponse } = await request.json();
  if (!rawEmail) {
    return jsonError('Email is required');
  }
  if (!credentialResponse) {
    return jsonError('Passkey registration is required to upgrade');
  }

  const database = db();
  const email = normalizeEmail(rawEmail);
  const config = getWebAuthnConfig(request.url, env);

  // Check email not already taken
  const existing = await database.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing.length > 0) {
    return jsonError('Email already registered', 409);
  }

  // Retrieve and consume the stored challenge
  const expectedChallenge = retrieveChallenge(cookies);
  if (!expectedChallenge) {
    return jsonError('Challenge expired, please try again');
  }

  try {
    const verification = await verifyRegistrationResponse({
      response: credentialResponse,
      expectedChallenge,
      expectedOrigin: config.origin,
      expectedRPID: config.rpID,
    });

    if (!verification.verified || !verification.registrationInfo) {
      return jsonError('Passkey verification failed');
    }

    const { credential } = verification.registrationInfo;

    // Check username availability before entering transaction
    const updates: Record<string, unknown> = { email, role: 'editor', ipAddress: null };
    if (rawUsername) {
      const newUsername = sanitizeUsername(rawUsername);
      if (newUsername !== user.username) {
        const existingUsername = await database
          .select({ id: users.id })
          .from(users)
          .where(eq(users.username, newUsername))
          .limit(1);
        if (existingUsername.length > 0) {
          return jsonError('Username is already taken', 409);
        }
      }
      updates.username = newUsername;
      const prev = [user.username];
      updates.previousUsernames = JSON.stringify(prev);
    }

    await withTransaction(database, async (tx) => {
      await storeCredential(tx, user.id, credential, credentialResponse.response?.transports);
      await tx.update(users).set(updates).where(eq(users.id, user.id));

      // Re-issue session to prevent session fixation: the old guest token
      // should not carry over into the elevated editor role.
      const oldToken = cookies.get('session_token')?.value;
      if (oldToken) {
        await destroySession(tx, oldToken);
      }
      await createSessionWithCookies(tx, user.id, cookies);
    });

    return jsonResponse({ success: true });
  } catch (err) {
    console.error('upgrade error:', err);
    return jsonError('Internal server error', 500);
  }
}

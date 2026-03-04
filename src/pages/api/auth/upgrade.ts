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

    // Store credential for the existing user
    await storeCredential(database, user.id, credential, credentialResponse.response?.transports);

    // Upgrade: set email, role, optionally username
    const updates: Record<string, unknown> = { email, role: 'editor', ipAddress: null };
    if (rawUsername) {
      updates.username = sanitizeUsername(rawUsername);
      // Store old pseudonym in previousUsernames
      const prev = [user.username];
      updates.previousUsernames = JSON.stringify(prev);
    }

    await database.update(users).set(updates).where(eq(users.id, user.id));

    // Re-issue session to prevent session fixation: the old guest token
    // should not carry over into the elevated editor role.
    const oldToken = cookies.get('session_token')?.value;
    if (oldToken) {
      await destroySession(database, oldToken);
    }
    await createSessionWithCookies(database, user.id, cookies);

    return jsonResponse({ success: true });
  } catch (err) {
    console.error('upgrade error:', err);
    return jsonError('Internal server error', 500);
  }
}

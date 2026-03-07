import type { APIContext } from 'astro';
import { env } from '../../../lib/env';
import { verifyRegistrationResponse } from '@simplewebauthn/server';
import { db } from '../../../lib/get-db';
import { users } from '../../../db/schema';
import { eq } from 'drizzle-orm';
import {
  buildCredentialInsert,
  buildSessionBatch,
  normalizeEmail,
  setSessionCookies,
  retrieveChallenge,
  getWebAuthnConfig,
  validateSession,
} from '../../../lib/auth';
import { sanitizeUsername } from '../../../lib/username';
import { jsonResponse, jsonError } from '../../../lib/api-response';
import { withBatch } from '../../../db/transaction';

export const prerender = false;

export async function POST({ request, cookies }: APIContext) {
  // Upgrade endpoints are under /api/auth/ which the middleware skips,
  // so we must validate the session ourselves.
  const token = cookies.get('session_token')?.value;
  const user = token ? await validateSession(db(), token) : null;
  if (!user || user.role !== 'guest') {
    return jsonError('Only guests can upgrade', 401);
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

    const oldToken = cookies.get('session_token')?.value;
    const now = new Date().toISOString();
    let token = '';

    await withBatch(database, (tx) => {
      const sessionPlan = buildSessionBatch(tx, user.id, {
        revokeToken: oldToken,
      });
      token = sessionPlan.token;

      return [
        buildCredentialInsert(
          tx,
          user.id,
          credential,
          credentialResponse.response?.transports,
          now,
        ),
        tx.update(users).set(updates).where(eq(users.id, user.id)),
        ...sessionPlan.statements,
      ];
    });

    setSessionCookies(cookies, token);

    return jsonResponse({ success: true });
  } catch (err) {
    console.error('upgrade error:', err);
    return jsonError('Internal server error', 500);
  }
}

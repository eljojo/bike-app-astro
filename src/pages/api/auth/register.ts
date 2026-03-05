import type { APIContext } from 'astro';
import { env } from '../../../lib/env';
import { verifyRegistrationResponse } from '@simplewebauthn/server';
import { db } from '../../../lib/get-db';
import { users } from '../../../db/schema';
import {
  normalizeEmail,
  generateId,
  createSessionWithCookies,
  storeCredential,
  retrieveChallenge,
  getWebAuthnConfig,
  isFirstUser,
} from '../../../lib/auth';
import { sanitizeUsername } from '../../../lib/username';
import { eq } from 'drizzle-orm';
import { jsonResponse, jsonError } from '../../../lib/api-response';


export const prerender = false;

export async function POST({ request, cookies }: APIContext) {
  try {
    const body = await request.json();
    const { email: rawEmail, username: rawUsername, credential: credentialResponse } = body;

    if (!rawEmail || !rawUsername || !credentialResponse) {
      return jsonError('Missing required fields');
    }

    const database = db();
    const email = normalizeEmail(rawEmail);
    const username = sanitizeUsername(rawUsername);
    const config = getWebAuthnConfig(request.url, env);

    // Retrieve the stored challenge
    const expectedChallenge = retrieveChallenge(cookies);
    if (!expectedChallenge) {
      return jsonError('Challenge expired, please try again');
    }

    // Check username not already taken
    const existingUsername = await database
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, username))
      .limit(1);

    if (existingUsername.length > 0) {
      return jsonError('Username is already taken', 409);
    }

    // Check if this is the first user (first user = admin, others = editor)
    const firstUser = await isFirstUser(database);

    // Verify the registration response
    const verification = await verifyRegistrationResponse({
      response: credentialResponse,
      expectedChallenge,
      expectedOrigin: config.origin,
      expectedRPID: config.rpID,
    });

    if (!verification.verified || !verification.registrationInfo) {
      return jsonError('Registration verification failed');
    }

    const { credential } = verification.registrationInfo;

    const userId = generateId();
    const now = new Date().toISOString();

    // Create user
    await database.insert(users).values({
      id: userId,
      email,
      username,
      role: firstUser ? 'admin' : 'editor',
      createdAt: now,
    });

    // Store credential
    await storeCredential(database, userId, credential, credentialResponse.response?.transports);

    // Create session
    await createSessionWithCookies(database, userId, cookies);

    return jsonResponse({ success: true });
  } catch (err) {
    console.error('register error:', err);
    return jsonError('Internal server error', 500);
  }
}

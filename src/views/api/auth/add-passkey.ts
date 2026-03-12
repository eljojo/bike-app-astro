export const prerender = false;

import type { APIContext } from 'astro';
import { env } from '../../../lib/env';
import { generateRegistrationOptions, verifyRegistrationResponse } from '@simplewebauthn/server';
import { db } from '../../../lib/get-db';
import { credentials } from '../../../db/schema';
import {
  getWebAuthnConfig,
  storeChallenge,
  retrieveChallenge,
  storeCredential,
  validateSession,
} from '../../../lib/auth';
import { eq } from 'drizzle-orm';
import { jsonResponse, jsonError } from '../../../lib/api-response';

export async function POST({ request, cookies }: APIContext): Promise<Response> {
  // Under /api/auth/ which middleware skips — validate session manually.
  const database = db();
  const sessionToken = cookies.get('session_token')?.value;
  const user = sessionToken ? await validateSession(database, sessionToken) : null;
  if (!user) return jsonError('Unauthorized', 401);

  const body = await request.json().catch(() => null);
  if (!body) return jsonError('Invalid request body', 400);

  const config = getWebAuthnConfig(request.url, env);

  // Step 1: Generate options (no credential in body yet)
  if (!body.credential) {
    // Get existing credentials to exclude
    const existingCreds = await database
      .select({ credentialId: credentials.credentialId })
      .from(credentials)
      .where(eq(credentials.userId, user.id));

    const options = await generateRegistrationOptions({
      rpName: config.rpName,
      rpID: config.rpID,
      userName: user.email || user.username,
      userDisplayName: user.username,
      attestationType: 'none',
      excludeCredentials: existingCreds.map(c => ({ id: c.credentialId })),
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
      },
    });

    storeChallenge(cookies, options.challenge);
    return jsonResponse(options as unknown as Record<string, unknown>);
  }

  // Step 2: Verify registration
  const challenge = retrieveChallenge(cookies);
  if (!challenge) return jsonError('Challenge expired. Please try again.', 400);

  try {
    const verification = await verifyRegistrationResponse({
      response: body.credential,
      expectedChallenge: challenge,
      expectedOrigin: config.origin,
      expectedRPID: config.rpID,
    });

    if (!verification.verified || !verification.registrationInfo) {
      return jsonError('Passkey verification failed', 400);
    }

    const { credential } = verification.registrationInfo;
    await storeCredential(
      database,
      user.id,
      { id: credential.id, publicKey: credential.publicKey, counter: credential.counter },
      body.credential.response?.transports,
    );

    return jsonResponse({ success: true });
  } catch (err) {
    console.error('add-passkey verification error:', err);
    return jsonError('Passkey registration failed', 400);
  }
}

import type { APIContext } from 'astro';
import { env } from '../../../lib/env/env.service';
import { verifyAuthenticationResponse } from '@simplewebauthn/server';
import { db } from '../../../lib/get-db';
import { credentials } from '../../../db/schema';
import {
  findUserByIdentifier,
  createSessionWithCookies,
  retrieveChallenge,
  getWebAuthnConfig,
} from '../../../lib/auth';
import { eq, and } from 'drizzle-orm';
import { jsonResponse, jsonError } from '../../../lib/api-response';

export const prerender = false;

export async function POST({ request, cookies }: APIContext) {
  try {
    const body = await request.json();
    const identifier = body.identifier || body.email;
    const { credential: authResponse } = body;

    if (!identifier || !authResponse) {
      return jsonError('Missing required fields');
    }

    const database = db();
    const config = getWebAuthnConfig(request.url, env);

    // Retrieve the stored challenge
    const expectedChallenge = retrieveChallenge(cookies);
    if (!expectedChallenge) {
      return jsonError('Challenge expired, please try again');
    }

    // Look up user by email or username
    const user = await findUserByIdentifier(database, identifier);

    if (!user) {
      return jsonError('Invalid email or credentials');
    }

    // Find the matching credential — must belong to this user
    const credResult = await database
      .select()
      .from(credentials)
      .where(and(
        eq(credentials.credentialId, authResponse.id),
        eq(credentials.userId, user.id)
      ))
      .limit(1);

    if (credResult.length === 0) {
      return jsonError('Credential not found');
    }

    const storedCredential = credResult[0];

    // Verify the authentication response
    const verification = await verifyAuthenticationResponse({
      response: authResponse,
      expectedChallenge,
      expectedOrigin: config.origin,
      expectedRPID: config.rpID,
      credential: {
        id: storedCredential.credentialId,
        publicKey: new Uint8Array(storedCredential.publicKey),
        counter: storedCredential.counter,
        transports: storedCredential.transports
          ? JSON.parse(storedCredential.transports)
          : undefined,
      },
    });

    if (!verification.verified) {
      return jsonError('Authentication failed');
    }

    // Update credential counter
    await database
      .update(credentials)
      .set({ counter: verification.authenticationInfo.newCounter })
      .where(eq(credentials.id, storedCredential.id));

    // Create session
    await createSessionWithCookies(database, user.id, cookies);

    return jsonResponse({ success: true });
  } catch (err) {
    console.error('login error:', err);
    return jsonError('Internal server error', 500);
  }
}

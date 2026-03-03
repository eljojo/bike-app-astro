import type { APIContext } from 'astro';
import { env } from '../../../lib/env';
import { verifyAuthenticationResponse } from '@simplewebauthn/server';
import { db } from '../../../lib/get-db';
import { users, credentials } from '../../../db/schema';
import {
  normalizeEmail,
  createSession,
  setSessionCookies,
  retrieveChallenge,
  getWebAuthnConfig,
} from '../../../lib/auth';
import { eq, and } from 'drizzle-orm';

export const prerender = false;

export async function POST({ request, cookies }: APIContext) {
  try {
    const body = await request.json();
    const { email: rawEmail, credential: authResponse } = body;

    if (!rawEmail || !authResponse) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const database = db();
    const email = normalizeEmail(rawEmail);
    const config = getWebAuthnConfig(request.url, env);

    // Retrieve the stored challenge
    const expectedChallenge = retrieveChallenge(cookies);
    if (!expectedChallenge) {
      return new Response(JSON.stringify({ error: 'Challenge expired, please try again' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Look up user
    const userResult = await database
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (userResult.length === 0) {
      return new Response(JSON.stringify({ error: 'Invalid email or credentials' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const user = userResult[0];

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
      return new Response(JSON.stringify({ error: 'Credential not found' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
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
        publicKey: new Uint8Array(storedCredential.publicKey as ArrayBuffer),
        counter: storedCredential.counter,
        transports: storedCredential.transports
          ? JSON.parse(storedCredential.transports)
          : undefined,
      },
    });

    if (!verification.verified) {
      return new Response(JSON.stringify({ error: 'Authentication failed' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Update credential counter
    await database
      .update(credentials)
      .set({ counter: verification.authenticationInfo.newCounter })
      .where(eq(credentials.id, storedCredential.id));

    // Create session
    const token = await createSession(database, user.id);
    setSessionCookies(cookies, token);

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('login error:', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

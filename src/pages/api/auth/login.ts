import type { APIContext } from 'astro';
import { verifyAuthenticationResponse } from '@simplewebauthn/server';
import { getDb } from '../../../db';
import { users, credentials } from '../../../db/schema';
import {
  normalizeEmail,
  createSession,
  setSessionCookies,
  retrieveChallenge,
  getWebAuthnConfig,
} from '../../../lib/auth';
import { eq } from 'drizzle-orm';

export const prerender = false;

export async function POST({ request, cookies, locals }: APIContext) {
  try {
    const body = await request.json();
    const { email: rawEmail, credential: authResponse } = body;

    if (!rawEmail || !authResponse) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const env = (locals as any).runtime.env;
    const db = getDb(env.DB);
    const email = normalizeEmail(rawEmail);
    const config = getWebAuthnConfig(env);

    // Retrieve the stored challenge
    const expectedChallenge = retrieveChallenge(cookies);
    if (!expectedChallenge) {
      return new Response(JSON.stringify({ error: 'Challenge expired, please try again' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Look up user
    const userResult = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (userResult.length === 0) {
      return new Response(JSON.stringify({ error: 'No account found with that email' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const user = userResult[0];

    // Find the matching credential
    const credResult = await db
      .select()
      .from(credentials)
      .where(eq(credentials.credentialId, authResponse.id))
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
    await db
      .update(credentials)
      .set({ counter: verification.authenticationInfo.newCounter })
      .where(eq(credentials.id, storedCredential.id));

    // Create session
    const token = await createSession(db, user.id);
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

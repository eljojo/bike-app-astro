import type { APIContext } from 'astro';
import { env } from '../../../lib/env';
import { verifyRegistrationResponse } from '@simplewebauthn/server';
import { db } from '../../../lib/get-db';
import { users, credentials } from '../../../db/schema';
import {
  normalizeEmail,
  generateId,
  createSession,
  setSessionCookies,
  retrieveChallenge,
  getWebAuthnConfig,
  isFirstUser,
} from '../../../lib/auth';
import { sanitizeDisplayName } from '../../../lib/draft-branch';


export const prerender = false;

export async function POST({ request, cookies }: APIContext) {
  try {
    const body = await request.json();
    const { email: rawEmail, displayName, credential: credentialResponse } = body;

    if (!rawEmail || !displayName || !credentialResponse) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const database = db();
    const email = normalizeEmail(rawEmail);
    const safeDisplayName = sanitizeDisplayName(displayName);
    const config = getWebAuthnConfig(request.url, env);

    // Retrieve the stored challenge
    const expectedChallenge = retrieveChallenge(cookies);
    if (!expectedChallenge) {
      return new Response(JSON.stringify({ error: 'Challenge expired, please try again' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
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
      return new Response(JSON.stringify({ error: 'Registration verification failed' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { credential } = verification.registrationInfo;

    const userId = generateId();
    const now = new Date().toISOString();

    // Create user
    await database.insert(users).values({
      id: userId,
      email,
      displayName: safeDisplayName,
      role: firstUser ? 'admin' : 'editor',
      createdAt: now,
    });

    // Store credential
    await database.insert(credentials).values({
      id: generateId(),
      userId,
      credentialId: credential.id,
      publicKey: new Uint8Array(credential.publicKey),
      counter: credential.counter,
      transports: credentialResponse.response?.transports
        ? JSON.stringify(credentialResponse.response.transports)
        : null,
      createdAt: now,
    });

    // Create session
    const token = await createSession(database, userId);
    setSessionCookies(cookies, token);

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('register error:', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

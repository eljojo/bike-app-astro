import type { APIContext } from 'astro';
import { env } from '../../../lib/env';
import { verifyRegistrationResponse } from '@simplewebauthn/server';
import { db } from '../../../lib/get-db';
import { users, credentials } from '../../../db/schema';
import { eq } from 'drizzle-orm';
import {
  normalizeEmail,
  generateId,
  createSession,
  destroySession,
  setSessionCookies,
  retrieveChallenge,
  getWebAuthnConfig,
} from '../../../lib/auth';
import { sanitizeDisplayName } from '../../../lib/draft-branch';

export const prerender = false;

export async function POST({ request, cookies, locals }: APIContext) {
  const user = locals.user;
  if (!user || user.role !== 'guest') {
    return new Response(JSON.stringify({ error: 'Only guests can upgrade' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  const { email: rawEmail, displayName, credential: credentialResponse } = await request.json();
  if (!rawEmail) {
    return new Response(JSON.stringify({ error: 'Email is required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }
  if (!credentialResponse) {
    return new Response(JSON.stringify({ error: 'Passkey registration is required to upgrade' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  const database = db();
  const email = normalizeEmail(rawEmail);
  const config = getWebAuthnConfig(request.url, env);

  // Check email not already taken
  const existing = await database.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing.length > 0) {
    return new Response(JSON.stringify({ error: 'Email already registered' }), {
      status: 409, headers: { 'Content-Type': 'application/json' },
    });
  }

  // Retrieve and consume the stored challenge
  const expectedChallenge = retrieveChallenge(cookies);
  if (!expectedChallenge) {
    return new Response(JSON.stringify({ error: 'Challenge expired, please try again' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const verification = await verifyRegistrationResponse({
      response: credentialResponse,
      expectedChallenge,
      expectedOrigin: config.origin,
      expectedRPID: config.rpID,
    });

    if (!verification.verified || !verification.registrationInfo) {
      return new Response(JSON.stringify({ error: 'Passkey verification failed' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const { credential } = verification.registrationInfo;

    // Store credential for the existing user
    await database.insert(credentials).values({
      id: generateId(),
      userId: user.id,
      credentialId: credential.id,
      publicKey: new Uint8Array(credential.publicKey),
      counter: credential.counter,
      transports: credentialResponse.response?.transports
        ? JSON.stringify(credentialResponse.response.transports)
        : null,
      createdAt: new Date().toISOString(),
    });

    // Upgrade: set email, role, optionally displayName
    const updates: Record<string, unknown> = { email, role: 'editor' };
    if (displayName) updates.displayName = sanitizeDisplayName(displayName);

    await database.update(users).set(updates).where(eq(users.id, user.id));

    // Re-issue session to prevent session fixation: the old guest token
    // should not carry over into the elevated editor role.
    const oldToken = cookies.get('session_token')?.value;
    if (oldToken) {
      await destroySession(database, oldToken);
    }
    const newToken = await createSession(database, user.id);
    setSessionCookies(cookies, newToken);

    return new Response(JSON.stringify({ success: true }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('upgrade error:', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
}

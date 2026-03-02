import type { APIContext } from 'astro';
import { verifyRegistrationResponse } from '@simplewebauthn/server';
import { getDb } from '../../../db';
import { users, credentials } from '../../../db/schema';
import {
  normalizeEmail,
  generateId,
  validateInviteCode,
  markInviteCodeUsed,
  createSession,
  setSessionCookies,
  retrieveChallenge,
  getWebAuthnConfig,
  isFirstUser,
} from '../../../lib/auth';
import { eq } from 'drizzle-orm';

export const prerender = false;

export async function POST({ request, cookies, locals }: APIContext) {
  try {
    const body = await request.json();
    const { email: rawEmail, displayName, handle, inviteCode, credential: credentialResponse } = body;

    if (!rawEmail || !displayName || !credentialResponse) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const env = locals.runtime.env;
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

    // Check if this is the first user or invite-based
    const firstUser = await isFirstUser(db);
    let inviteId: string | null = null;

    if (!firstUser) {
      if (!inviteCode) {
        return new Response(JSON.stringify({ error: 'Invite code is required' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const invite = await validateInviteCode(db, inviteCode);
      if (!invite) {
        return new Response(JSON.stringify({ error: 'Invalid or expired invite code' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      inviteId = invite.id;
    }

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

    const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;

    // Create user
    const userId = generateId();
    const now = new Date().toISOString();

    await db.insert(users).values({
      id: userId,
      email,
      displayName,
      handle: handle || null,
      role: firstUser ? 'admin' : 'editor',
      createdAt: now,
    });

    // Store credential
    await db.insert(credentials).values({
      id: generateId(),
      userId,
      credentialId: credential.id,
      publicKey: Buffer.from(credential.publicKey),
      counter: credential.counter,
      transports: credentialResponse.response?.transports
        ? JSON.stringify(credentialResponse.response.transports)
        : null,
      createdAt: now,
    });

    // Atomically mark invite code as used (prevents race condition)
    if (inviteId) {
      const claimed = await markInviteCodeUsed(db, inviteId, userId);
      if (!claimed) {
        return new Response(JSON.stringify({ error: 'Invite code was already used' }), {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // Create session
    const token = await createSession(db, userId);
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

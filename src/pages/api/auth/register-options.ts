import type { APIContext } from 'astro';
import { env } from '../../../lib/env';
import { generateRegistrationOptions } from '@simplewebauthn/server';
import { getDb } from '../../../db';
import { users, credentials } from '../../../db/schema';
import {
  normalizeEmail,
  validateInviteCode,
  getWebAuthnConfig,
  storeChallenge,
  isFirstUser,
} from '../../../lib/auth';
import { eq } from 'drizzle-orm';

export const prerender = false;

export async function POST({ request, cookies }: APIContext) {
  try {
    const body = await request.json();
    const { email: rawEmail, displayName, handle, inviteCode } = body;

    if (!rawEmail || !displayName) {
      return new Response(JSON.stringify({ error: 'Email and display name are required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const db = getDb(env.DB);
    const email = normalizeEmail(rawEmail);

    // Check if this is the first user (setup flow) or invite-based registration
    const firstUser = await isFirstUser(db);

    if (!firstUser) {
      // Require invite code for non-first users
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
    }

    // Check if email is already registered
    const existingUser = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (existingUser.length > 0) {
      return new Response(JSON.stringify({ error: 'Unable to register with this email' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const config = getWebAuthnConfig(env);

    const options = await generateRegistrationOptions({
      rpName: config.rpName,
      rpID: config.rpID,
      userName: email,
      userDisplayName: displayName,
      attestationType: 'none',
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
      },
    });

    // Store challenge in cookie for verification
    storeChallenge(cookies, options.challenge);

    return new Response(JSON.stringify(options), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('register-options error:', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

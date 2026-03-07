import type { APIContext } from 'astro';
import { env } from '../../../lib/env';
import { generateRegistrationOptions } from '@simplewebauthn/server';
import { db } from '../../../lib/get-db';
import { users } from '../../../db/schema';
import {
  normalizeEmail,
  getWebAuthnConfig,
  storeChallenge,
} from '../../../lib/auth';
import { sanitizeUsername } from '../../../lib/username';
import { eq } from 'drizzle-orm';
import { jsonResponse, jsonError } from '../../../lib/api-response';

export const prerender = false;

export async function POST({ request, cookies }: APIContext) {
  try {
    const body = await request.json();
    const { email: rawEmail, username: rawUsername } = body;

    if (!rawEmail || !rawUsername) {
      return jsonError('Email and username are required');
    }

    const database = db();
    const email = normalizeEmail(rawEmail);
    const username = sanitizeUsername(rawUsername);

    // Check if email is already registered
    const existingUser = await database
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (existingUser.length > 0) {
      return jsonError('Unable to register with this email');
    }

    // Check if username is already taken
    const existingUsername = await database
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, username))
      .limit(1);

    if (existingUsername.length > 0) {
      return jsonError('Username is already taken');
    }

    const config = getWebAuthnConfig(request.url, env);

    const options = await generateRegistrationOptions({
      rpName: config.rpName,
      rpID: config.rpID,
      userName: email,
      userDisplayName: username,
      attestationType: 'none',
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
      },
    });

    // Store challenge in cookie for verification
    storeChallenge(cookies, options.challenge);

    return jsonResponse(options as unknown as Record<string, unknown>);
  } catch (err) {
    console.error('register-options error:', err);
    return jsonError('Internal server error', 500);
  }
}

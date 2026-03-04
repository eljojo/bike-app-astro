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
import { eq } from 'drizzle-orm';
import { jsonResponse, jsonError } from '../../../lib/api-response';

export const prerender = false;

export async function POST({ request, cookies }: APIContext) {
  try {
    const body = await request.json();
    const { email: rawEmail, displayName } = body;

    if (!rawEmail || !displayName) {
      return jsonError('Email and display name are required');
    }

    const database = db();
    const email = normalizeEmail(rawEmail);

    // Check if email is already registered
    const existingUser = await database
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (existingUser.length > 0) {
      return jsonError('Unable to register with this email');
    }

    const config = getWebAuthnConfig(request.url, env);

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

    return jsonResponse(options as unknown as Record<string, unknown>);
  } catch (err) {
    console.error('register-options error:', err);
    return jsonError('Internal server error', 500);
  }
}
